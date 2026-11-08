export const greenMotion = /* glsl */ `
  vec3 greenHash33(vec3 point) {
    vec3 value = fract(point * vec3(0.1031, 0.1030, 0.0973));
    value += vec3(dot(value, value.yxz + 33.33));
    return fract((value.xxy + value.yxx) * value.zyx) * 2.0 - 1.0;
  }

  float greenNoise3(vec3 point) {
    vec3 cell = floor(point), local = fract(point);
    vec3 curve = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float n000 = dot(greenHash33(cell), local);
    float n100 = dot(greenHash33(cell + vec3(1.0, 0.0, 0.0)), local - vec3(1.0, 0.0, 0.0));
    float n010 = dot(greenHash33(cell + vec3(0.0, 1.0, 0.0)), local - vec3(0.0, 1.0, 0.0));
    float n110 = dot(greenHash33(cell + vec3(1.0, 1.0, 0.0)), local - vec3(1.0, 1.0, 0.0));
    float n001 = dot(greenHash33(cell + vec3(0.0, 0.0, 1.0)), local - vec3(0.0, 0.0, 1.0));
    float n101 = dot(greenHash33(cell + vec3(1.0, 0.0, 1.0)), local - vec3(1.0, 0.0, 1.0));
    float n011 = dot(greenHash33(cell + vec3(0.0, 1.0, 1.0)), local - vec3(0.0, 1.0, 1.0));
    float n111 = dot(greenHash33(cell + vec3(1.0, 1.0, 1.0)), local - vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, curve.x), mix(n010, n110, curve.x), curve.y),
      mix(mix(n001, n101, curve.x), mix(n011, n111, curve.x), curve.y), curve.z) * 1.8;
  }

  void applyGreenMotion(inout vec3 p, float time, vec4 metadata) {
    if (metadata.w > 0.5) return;
    float gust = (sin(p.z * 0.35 - time * 1.2) * 0.5
      + greenNoise3(vec3(p.z * 0.2 - time * 0.4, metadata.y, 1.0)) * 0.5) * 0.6;
    p += vec3(sin(time * 5.0 + metadata.x * 0.37),
      cos(time * 4.0 + metadata.x * 0.21), 0.0) * 0.012 + vec3(gust * 0.04, 0.0, 0.0);
    if (p.y < 0.0) p.y = metadata.z * 0.2;
  }
`
