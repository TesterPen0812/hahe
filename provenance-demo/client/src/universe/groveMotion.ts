/**
 * The grove (mode 22): crowns sway and leaves tremble, trunks lean a little (the amber grove's own
 * motion), and the trees rooted inside the end clearing are not there. The clearing is uCenter:
 * x, z of its middle and its radius (0: none); every grain carries its tree's root in aPrism.xy.
 * Shared by rendering and the persistent particle state.
 */
export const grovePlacement = /* glsl */ `
    } else if (uMode > 21.5 && uMode < 22.5) {
      if (aHang.w > 0.5) {
        p += vec3(sin(t * 0.4 + aHang.x), 0.0, cos(t * 0.33 + aHang.x)) * 0.1;
        p.y += sin(t * 6.0 + aHang.y) * 0.012;
      } else if (aHang.w > -0.5) {
        p += vec3(greenNoise3(vec3(aHang.x * 2.0, aHang.y, 0.0)), 0.0,
          greenNoise3(vec3(aHang.x * 2.0, aHang.y, 4.0))) * 0.3;
      }
      if (uCenter.z > 0.0 && aHang.w > -0.5) {
        vFade = smoothstep(uCenter.z, uCenter.z + 3.5, distance(aPrism.xy, uCenter.xy));
      }
`
