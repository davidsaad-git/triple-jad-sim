/**
 * Flat-shaded, per-vertex coloured geometry (terrain and untextured models).
 * Colour is supplied as RGB bytes already lit on the CPU, the way the client
 * bakes lighting into face colours.
 */
export const COLOR_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_priority;
uniform mat4 u_viewProjection;
uniform mat4 u_model;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
`

export const COLOR_FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
uniform float u_brightness;
out vec4 fragColor;
void main() {
  if (v_color.a < 0.004) discard;
  fragColor = vec4(v_color.rgb * u_brightness, v_color.a);
}
`

/** Textured variant: same layout plus texture id/uv; the atlas is a 2D array texture. */
export const TEXTURE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_priority;
layout(location = 3) in vec3 a_texcoord; // u, v, layer
uniform mat4 u_viewProjection;
uniform mat4 u_model;
out vec4 v_color;
out vec3 v_texcoord;
void main() {
  v_color = a_color;
  v_texcoord = a_texcoord;
  gl_Position = u_viewProjection * u_model * vec4(a_position, 1.0);
}
`

export const TEXTURE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec4 v_color;
in vec3 v_texcoord;
uniform sampler2DArray u_textures;
uniform float u_brightness;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_textures, v_texcoord);
  if (tex.a < 0.5) discard;
  // The client multiplies texture RGB by the face's light level (stored in v_color.r).
  fragColor = vec4(tex.rgb * v_color.rgb * u_brightness, v_color.a);
}
`
