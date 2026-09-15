/**
 * Atmospheric sky with volumetric clouds.
 *
 * A simplified Preetham/Hosek-style analytic sky for the base gradient, plus
 * raymarched cloud density in a slab above the player. Analytic scattering is
 * the right call here: a full multiple-scattering solution costs more than the
 * entire terrain pass, and at Alola's scale the difference is invisible next to
 * the clouds themselves.
 *
 * Cloud coverage and density are driven directly by the weather system, so the
 * sky *is* the weather forecast — a player can look at the horizon and decide
 * to sail toward the storm.
 */

export const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;

  void main() {
    // Direction from the camera through this vertex of the sky dome.
    vWorldDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Force to the far plane so the sky never occludes anything.
    gl_Position = pos.xyww;
  }
`;

export const SKY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldDirection;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;

  uniform float uCloudCoverage;   // 0-1 from the weather system.
  uniform float uCloudDensity;
  uniform float uCloudHeight;     // Slab base, in metres.
  uniform float uCloudThickness;
  uniform vec3 uWindOffset;       // Accumulated wind drift.
  uniform float uTime;

  uniform float uStarIntensity;   // Rises as daylight falls.
  uniform float uAuroraIntensity; // Ultra Beast events raise this.

  // --- Hash / value noise. Cheap, and adequate for cloud shape.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += valueNoise(p) * amp;
      p *= 2.02;
      amp *= 0.5;
    }
    return sum;
  }

  /** Cloud density at a point in the slab. */
  float cloudDensity(vec3 p) {
    vec3 samplePos = p * 0.0012 + uWindOffset * 0.0008;
    float base = fbm(samplePos);

    // Coverage carves the noise field: low coverage leaves only the densest
    // peaks, which reads as scattered cumulus rather than uniform haze.
    float coverage = 1.0 - uCloudCoverage;
    float d = smoothstep(coverage, coverage + 0.25, base);

    // Vertical falloff so the slab has soft tops and flat-ish bases.
    float heightFrac = clamp((p.y - uCloudHeight) / uCloudThickness, 0.0, 1.0);
    float shape = smoothstep(0.0, 0.18, heightFrac) * smoothstep(1.0, 0.55, heightFrac);

    return d * shape * uCloudDensity;
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);

    // --- Base sky gradient.
    float up = dir.y;
    vec3 sky;
    if (up >= 0.0) {
      sky = mix(uHorizonColor, uZenithColor, pow(clamp(up, 0.0, 1.0), 0.55));
    } else {
      sky = mix(uHorizonColor, uGroundColor, pow(clamp(-up, 0.0, 1.0), 0.5));
    }

    // --- Sun disc and bloom.
    float sunDot = max(dot(dir, -uSunDirection), 0.0);
    float disc = smoothstep(0.9995, 0.9999, sunDot);
    float bloom = pow(sunDot, 90.0) * 0.6 + pow(sunDot, 8.0) * 0.12;
    sky += uSunColor * (disc * 12.0 + bloom) * uSunIntensity;

    // --- Stars. Only above the horizon, and only once it is dark.
    if (up > 0.0 && uStarIntensity > 0.01) {
      vec3 starCoord = dir * 220.0;
      float star = hash(floor(starCoord));
      float twinkle = 0.75 + 0.25 * sin(uTime * 2.4 + star * 90.0);
      float visible = step(0.9975, star) * twinkle;
      sky += vec3(0.85, 0.9, 1.0) * visible * uStarIntensity;
    }

    // --- Aurora. Story-driven; signals an Ultra Wormhole before it opens.
    if (uAuroraIntensity > 0.01 && up > 0.05) {
      float band = fbm(vec3(dir.xz * 5.0, uTime * 0.06));
      float curtain = smoothstep(0.45, 0.85, band) * smoothstep(0.02, 0.5, up);
      vec3 auroraColor = mix(vec3(0.15, 0.95, 0.55), vec3(0.55, 0.25, 0.95), band);
      sky += auroraColor * curtain * uAuroraIntensity;
    }

    // --- Clouds: raymarch the slab, but only for rays that can reach it.
    if (dir.y > 0.02 && uCloudCoverage > 0.01) {
      float tStart = (uCloudHeight - cameraPosition.y) / dir.y;
      float tEnd = (uCloudHeight + uCloudThickness - cameraPosition.y) / dir.y;

      if (tEnd > 0.0) {
        tStart = max(tStart, 0.0);
        const int STEPS = 24;
        float stepSize = (tEnd - tStart) / float(STEPS);

        float transmittance = 1.0;
        vec3 scattered = vec3(0.0);

        for (int i = 0; i < STEPS; i++) {
          if (transmittance < 0.02) break;
          vec3 p = cameraPosition + dir * (tStart + stepSize * float(i));
          float density = cloudDensity(p);
          if (density <= 0.001) continue;

          // Single-scatter lighting: one short march toward the sun.
          float lightDensity = 0.0;
          for (int j = 1; j <= 3; j++) {
            lightDensity += cloudDensity(p - uSunDirection * float(j) * 120.0);
          }
          float lightTransmittance = exp(-lightDensity * 0.6);

          // Henyey-Greenstein forward scattering gives clouds their bright
          // silver-lined rim when looking toward the sun.
          float cosTheta = dot(dir, -uSunDirection);
          float g = 0.35;
          float hg = (1.0 - g * g) /
            (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));

          vec3 lit = uSunColor * uSunIntensity * lightTransmittance * (0.4 + hg * 1.6);
          lit += uZenithColor * 0.25; // Ambient from the sky.

          float absorbed = density * stepSize * 0.012;
          scattered += lit * absorbed * transmittance;
          transmittance *= exp(-absorbed);
        }

        sky = sky * transmittance + scattered;
      }
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export function defaultSkyUniforms(): Record<string, { value: unknown }> {
  return {
    uSunDirection: { value: [0, -1, 0] },
    uSunColor: { value: [1, 0.96, 0.88] },
    uSunIntensity: { value: 1 },
    uZenithColor: { value: [0.18, 0.4, 0.78] },
    uHorizonColor: { value: [0.72, 0.82, 0.92] },
    uGroundColor: { value: [0.3, 0.3, 0.32] },
    uCloudCoverage: { value: 0.3 },
    uCloudDensity: { value: 1 },
    uCloudHeight: { value: 900 },
    uCloudThickness: { value: 700 },
    uWindOffset: { value: [0, 0, 0] },
    uTime: { value: 0 },
    uStarIntensity: { value: 0 },
    uAuroraIntensity: { value: 0 },
  };
}
