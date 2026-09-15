/**
 * Terrain shader.
 *
 * Blends up to four biome materials per pixel from vertex-baked weights,
 * adds triplanar projection on steep slopes (so cliffs are not stretched
 * smears), and applies height-based snow and wetness that respond to the live
 * weather system.
 *
 * Kept as a string rather than a separate .glsl file so the package stays
 * importable from Node without a bundler plugin — which is what lets the
 * shader be unit-tested for compile-ability in CI.
 */

export const TERRAIN_VERTEX_SHADER = /* glsl */ `
  attribute vec4 biomeWeight;
  attribute vec4 biomeIndex;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vBiomeWeight;
  varying vec4 vBiomeIndex;
  varying float vHeight;
  varying float vSlope;

  uniform vec3 uChunkOrigin;

  void main() {
    vUv = uv;
    vBiomeWeight = biomeWeight;
    vBiomeIndex = biomeIndex;

    vec3 worldPos = position + uChunkOrigin;
    vWorldPosition = worldPos;
    vHeight = worldPos.y;

    vNormal = normalize(normalMatrix * normal);
    // Slope as the deviation of the world-space normal from vertical.
    vSlope = 1.0 - normal.y;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const TERRAIN_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vBiomeWeight;
  varying vec4 vBiomeIndex;
  varying float vHeight;
  varying float vSlope;

  // One array texture per channel, indexed by biome.
  uniform sampler2DArray uAlbedoArray;
  uniform sampler2DArray uNormalArray;

  // Lighting.
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uAmbientColor;
  uniform float uSunIntensity;

  // Weather-driven surface response.
  uniform float uWetness;      // 0-1, raises specular and darkens albedo.
  uniform float uSnowLine;     // Metres above which snow accumulates.
  uniform float uSnowAmount;   // 0-1.

  // Fog.
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogHeightFalloff;

  // Texture tiling in metres per repeat.
  uniform float uTileScale;

  /**
   * Triplanar sampling.
   *
   * Planar UV projection stretches badly on anything steeper than ~45 degrees,
   * which is most of a volcano and all of a canyon wall. Triplanar blends three
   * axis-aligned projections by the normal, so a cliff face looks like rock
   * rather than a smeared ribbon. It costs three samples instead of one, so it
   * is only blended in where the slope actually warrants it.
   */
  vec3 triplanarAlbedo(float layer, vec3 worldPos, vec3 normal) {
    vec3 blend = abs(normal);
    blend = pow(blend, vec3(4.0));
    blend /= (blend.x + blend.y + blend.z);

    vec2 uvX = worldPos.zy / uTileScale;
    vec2 uvY = worldPos.xz / uTileScale;
    vec2 uvZ = worldPos.xy / uTileScale;

    vec3 cx = texture(uAlbedoArray, vec3(uvX, layer)).rgb;
    vec3 cy = texture(uAlbedoArray, vec3(uvY, layer)).rgb;
    vec3 cz = texture(uAlbedoArray, vec3(uvZ, layer)).rgb;

    return cx * blend.x + cy * blend.y + cz * blend.z;
  }

  void main() {
    vec3 normal = normalize(vNormal);

    // Blend the biome layers by their baked weights.
    float totalWeight =
      vBiomeWeight.x + vBiomeWeight.y + vBiomeWeight.z + vBiomeWeight.w;
    float invTotal = totalWeight > 0.0001 ? 1.0 / totalWeight : 1.0;

    vec3 albedo = vec3(0.0);
    albedo += triplanarAlbedo(vBiomeIndex.x, vWorldPosition, normal) * vBiomeWeight.x * invTotal;
    if (vBiomeWeight.y > 0.001) {
      albedo += triplanarAlbedo(vBiomeIndex.y, vWorldPosition, normal) * vBiomeWeight.y * invTotal;
    }

    // Snow accumulates on upward faces above the snow line. Steep faces shed
    // it, which is what keeps a mountain reading as rock-and-snow rather than
    // as a white blob.
    float snowHeight = smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, vHeight);
    float snowSlope = smoothstep(0.55, 0.15, vSlope);
    float snow = snowHeight * snowSlope * uSnowAmount;
    albedo = mix(albedo, vec3(0.92, 0.94, 0.98), snow);

    // Wetness darkens and smooths. Rain visibly changes the ground rather than
    // just adding particles in front of it.
    albedo *= mix(1.0, 0.68, uWetness);
    float roughness = mix(0.92, 0.28, max(uWetness, snow * 0.4));

    // Lambert diffuse plus a wrapped term, which keeps shadowed slopes readable
    // instead of crushing to black in the stylised art direction.
    float ndotl = dot(normal, -uSunDirection);
    float wrapped = max(0.0, (ndotl + 0.35) / 1.35);
    vec3 diffuse = uSunColor * uSunIntensity * wrapped;

    // Cheap specular for wet and snowy surfaces.
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 halfDir = normalize(viewDir - uSunDirection);
    float spec = pow(max(dot(normal, halfDir), 0.0), mix(8.0, 64.0, 1.0 - roughness));
    vec3 specular = uSunColor * spec * (1.0 - roughness) * 0.5;

    vec3 color = albedo * (diffuse + uAmbientColor) + specular;

    // Height-based exponential fog. Density falls off with altitude so valleys
    // hold mist while peaks stay clear — the single cheapest way to make a
    // large landscape read as large.
    float distanceToCamera = length(cameraPosition - vWorldPosition);
    float heightFactor = exp(-max(0.0, vWorldPosition.y) * uFogHeightFalloff);
    float fogAmount = 1.0 - exp(-distanceToCamera * uFogDensity * heightFactor);
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Uniform defaults, so the material can be constructed without a full scene. */
export function defaultTerrainUniforms(): Record<string, { value: unknown }> {
  return {
    uChunkOrigin: { value: [0, 0, 0] },
    uAlbedoArray: { value: null },
    uNormalArray: { value: null },
    uSunDirection: { value: [0, -1, 0] },
    uSunColor: { value: [1, 0.96, 0.9] },
    uAmbientColor: { value: [0.25, 0.28, 0.35] },
    uSunIntensity: { value: 1 },
    uWetness: { value: 0 },
    uSnowLine: { value: 1100 },
    uSnowAmount: { value: 0 },
    uFogColor: { value: [0.72, 0.8, 0.9] },
    uFogDensity: { value: 0.0012 },
    uFogHeightFalloff: { value: 0.0015 },
    uTileScale: { value: 12 },
  };
}
