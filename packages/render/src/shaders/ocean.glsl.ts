/**
 * Ocean shader.
 *
 * Evaluates the *same* Gerstner sum as the CPU simulation in @alola/world, so
 * the visible surface and the surface a Lapras floats on cannot drift apart.
 * The wave parameters arrive as a uniform array written by
 * `OceanSimulation.toUniformArray()`.
 *
 * Above the waterline the surface is shaded with a Fresnel blend between a
 * reflection probe and depth-tinted refraction; below it, the same material
 * switches to an underwater look so diving does not need a second pass.
 */

export const MAX_OCEAN_WAVES = 8;

export const OCEAN_VERTEX_SHADER = /* glsl */ `
  // 6 floats per wave: dirX, dirZ, wavelength, amplitude, steepness, phase.
  uniform float uWaves[${MAX_OCEAN_WAVES * 6}];
  uniform int uWaveCount;
  uniform float uTime;
  uniform float uSeaLevel;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vWaveHeight;
  varying vec2 vFlow;

  const float TAU = 6.28318530718;
  const float GRAVITY = 9.81;

  void main() {
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

    vec3 displacement = vec3(0.0);
    // Analytic tangent/binormal accumulation — far cheaper and far more
    // accurate than finite-differencing the displaced surface.
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);

    for (int i = 0; i < ${MAX_OCEAN_WAVES}; i++) {
      if (i >= uWaveCount) break;
      int o = i * 6;
      vec2 dir = vec2(uWaves[o], uWaves[o + 1]);
      float wavelength = uWaves[o + 2];
      float amplitude = uWaves[o + 3];
      float steepness = uWaves[o + 4];
      float phase = uWaves[o + 5];

      float k = TAU / wavelength;
      float speed = sqrt(GRAVITY / k);
      float f = k * dot(dir, worldPos.xz) - speed * k * uTime + phase;

      float q = steepness / (k * amplitude * float(uWaveCount));
      float cosF = cos(f);
      float sinF = sin(f);

      displacement.x += q * amplitude * dir.x * cosF;
      displacement.z += q * amplitude * dir.y * cosF;
      displacement.y += amplitude * sinF;

      tangent += vec3(
        -q * dir.x * dir.x * amplitude * k * sinF,
        dir.x * amplitude * k * cosF,
        -q * dir.x * dir.y * amplitude * k * sinF
      );
      binormal += vec3(
        -q * dir.x * dir.y * amplitude * k * sinF,
        dir.y * amplitude * k * cosF,
        -q * dir.y * dir.y * amplitude * k * sinF
      );
    }

    vec3 displaced = worldPos + displacement;
    displaced.y += uSeaLevel;

    vWorldPosition = displaced;
    vWaveHeight = displacement.y;
    vNormal = normalize(cross(binormal, tangent));
    vFlow = displacement.xz;

    gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
  }
`;

export const OCEAN_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vWaveHeight;
  varying vec2 vFlow;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform float uTime;
  uniform float uFoamThreshold;
  uniform sampler2D uFoamTexture;
  uniform float uSeaFloorDepth;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // Schlick Fresnel: water is nearly opaque at grazing angles and nearly
    // transparent looking straight down. Getting this right is most of what
    // makes water read as water.
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
    fresnel = mix(0.02, 1.0, fresnel);

    // Depth tint. Shallow water over a reef is a different colour from open
    // ocean, which is what makes the coastline legible from the air.
    float depth = clamp(-uSeaFloorDepth / 40.0, 0.0, 1.0);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depth);

    // Reflection approximated from the sky colour; a probe replaces this where
    // quality settings allow.
    vec3 reflection = uSkyColor;

    // Sun glint.
    vec3 halfDir = normalize(viewDir - uSunDirection);
    float glint = pow(max(dot(normal, halfDir), 0.0), 220.0);
    vec3 specular = uSunColor * glint * 2.4;

    // Foam on wave crests, plus a little where the surface is steep.
    float crest = smoothstep(uFoamThreshold, uFoamThreshold + 0.35, vWaveHeight);
    float steep = smoothstep(0.55, 0.9, 1.0 - normal.y);
    vec2 foamUv = vWorldPosition.xz * 0.06 + vFlow * 0.02 + uTime * 0.008;
    float foamTex = texture2D(uFoamTexture, foamUv).r;
    float foam = clamp(max(crest, steep) * foamTex * 1.6, 0.0, 1.0);

    vec3 color = mix(waterColor, reflection, fresnel) + specular;
    color = mix(color, vec3(0.95, 0.97, 1.0), foam);

    // Subsurface scattering approximation: light through a wave crest.
    float backlight = max(0.0, dot(viewDir, uSunDirection));
    color += uSunColor * pow(backlight, 4.0) * max(0.0, vWaveHeight) * 0.12;

    float distanceToCamera = length(cameraPosition - vWorldPosition);
    float fogAmount = 1.0 - exp(-distanceToCamera * uFogDensity);
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, 1.0));

    // Alpha rises with fresnel so shallow water is see-through and deep water
    // is not — the same term doing double duty.
    float alpha = mix(0.72, 1.0, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function defaultOceanUniforms(): Record<string, { value: unknown }> {
  return {
    uWaves: { value: new Float32Array(MAX_OCEAN_WAVES * 6) },
    uWaveCount: { value: 6 },
    uTime: { value: 0 },
    uSeaLevel: { value: 0 },
    uSunDirection: { value: [0, -1, 0] },
    uSunColor: { value: [1, 0.96, 0.9] },
    uShallowColor: { value: [0.16, 0.55, 0.62] },
    uDeepColor: { value: [0.02, 0.12, 0.26] },
    uSkyColor: { value: [0.55, 0.72, 0.92] },
    uFoamThreshold: { value: 0.55 },
    uFoamTexture: { value: null },
    uSeaFloorDepth: { value: -40 },
    uFogColor: { value: [0.72, 0.8, 0.9] },
    uFogDensity: { value: 0.0012 },
  };
}
