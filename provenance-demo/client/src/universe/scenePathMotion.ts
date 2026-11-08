export const scenePathMotion = /* glsl */ `
  vec3 streamHash33(vec3 point) {
    vec3 value = fract(point * vec3(0.1031, 0.1030, 0.0973));
    value += vec3(dot(value, value.yxz + 33.33));
    return fract((value.xxy + value.yxx) * value.zyx) * 2.0 - 1.0;
  }
  float streamNoise3(vec3 point) {
    vec3 cell = floor(point), local = fract(point);
    vec3 curve = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float n000 = dot(streamHash33(cell), local);
    float n100 = dot(streamHash33(cell + vec3(1.0, 0.0, 0.0)), local - vec3(1.0, 0.0, 0.0));
    float n010 = dot(streamHash33(cell + vec3(0.0, 1.0, 0.0)), local - vec3(0.0, 1.0, 0.0));
    float n110 = dot(streamHash33(cell + vec3(1.0, 1.0, 0.0)), local - vec3(1.0, 1.0, 0.0));
    float n001 = dot(streamHash33(cell + vec3(0.0, 0.0, 1.0)), local - vec3(0.0, 0.0, 1.0));
    float n101 = dot(streamHash33(cell + vec3(1.0, 0.0, 1.0)), local - vec3(1.0, 0.0, 1.0));
    float n011 = dot(streamHash33(cell + vec3(0.0, 1.0, 1.0)), local - vec3(0.0, 1.0, 1.0));
    float n111 = dot(streamHash33(cell + vec3(1.0, 1.0, 1.0)), local - vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, curve.x), mix(n010, n110, curve.x), curve.y),
      mix(mix(n001, n101, curve.x), mix(n011, n111, curve.x), curve.y), curve.z) * 1.8;
  }

  // metadata: lane, pace, vertical random, initial z.
  vec3 streamPlace(float time, vec4 metadata, vec3 path, vec3 settings) {
    float z = 6.0 - mod(6.0 - metadata.w + time * settings.x * metadata.y, path.x + 8.0);
    float amount = clamp(-z / path.x, 0.0, 1.0);
    float envelope = sin(amount * 3.14159265);
    float x = path.y * envelope * envelope * sin(amount * 6.28318531 * path.z);
    float ripple = streamNoise3(vec3(z * 1.5, metadata.x * 2.0, time * 0.8)) * 0.02;
    return vec3(x + metadata.x, settings.z + abs(ripple) + metadata.z * 0.015, z);
  }
`

/** Insert before the broad cave fallback in the shared placement shader. */
export const scenePathPlacement = /* glsl */ `
    } else if (uMode > 17.5 && uMode < 18.5) {
      p = streamPlace(t, aHang, uCenter, uAxis);
      vec3 before = streamPlace(t - 0.0166667, aHang, uCenter, uAxis);
      velocity = distance(p, before) < 4.0 ? (p - before) * 60.0 : vec3(0.0);
`

/**
 * The same stream on an authored curve (the journey's spline walks): the centerline is sampled
 * into uCurveTex by arc length, ground height included. Include after scenePathMotion.
 */
export const curveStreamMotion = /* glsl */ `
  uniform sampler2D uCurveTex;
  uniform vec2 uCurveInfo;        // samples, arc length
  vec3 curveSample(float s) {
    float n = uCurveInfo.x;
    float x = clamp(s, 0.0, 1.0) * (n - 1.0);
    float i = floor(x);
    vec3 a = texture2D(uCurveTex, vec2((i + 0.5) / n, 0.5)).xyz;
    vec3 b = texture2D(uCurveTex, vec2((min(i + 1.0, n - 1.0) + 0.5) / n, 0.5)).xyz;
    return mix(a, b, x - i);
  }
  // metadata: lane, pace, vertical random, starting fraction. settings: speed, width, height.
  vec3 curveStreamPlace(float time, vec4 metadata, vec3 settings, out float along) {
    along = fract(metadata.w + time * settings.x * metadata.y / max(uCurveInfo.y, 0.001));
    vec3 here = curveSample(along);
    vec3 next = curveSample(along + 1.0 / max(uCurveInfo.x, 2.0));
    vec2 tangent = normalize(next.xz - here.xz + vec2(0.0, -0.0001));
    vec3 side = vec3(-tangent.y, 0.0, tangent.x);
    float ripple = streamNoise3(vec3(along * uCurveInfo.y * 1.5, metadata.x * 2.0, time * 0.8)) * 0.02;
    return here + side * metadata.x + vec3(0.0, settings.z + abs(ripple) + metadata.z * 0.015, 0.0);
  }
`

export const curveStreamPlacement = /* glsl */ `
    } else if (uMode > 18.5 && uMode < 19.5) {
      float along, before;
      p = curveStreamPlace(t, aHang, uAxis, along);
      vec3 last = curveStreamPlace(t - 0.0166667, aHang, uAxis, before);
      velocity = distance(p, last) < 4.0 ? (p - last) * 60.0 : vec3(0.0);
      // Born at the start of the walk and gone into the door at its end, without a pop.
      vFade = smoothstep(0.0, 0.015, along) * (1.0 - smoothstep(0.985, 1.0, along));
`
