/**
 * GLSL of the `scene-base` program (bundle `af`/`rf`
 *), written from the documented maths:
 *
 * vertex: MVP * position; NDC depth bias (u_zBias * w) and per-face bias
 * (faceBias / 128 on clip z); texture UV scroll for animated layers
 * (u_textureAnimTime * dir / 128); untextured colour = OSRS HSL -> RGB with
 * gamma 0.6, textured colour = lightness / 127 (a shade factor).
 *
 * fragment: textures sampled .bgra (ARGB ints uploaded as bytes), texels
 * with alpha < 1 discarded, texel ^ 0.6 * shade; optional alpha discard;
 * brightness gain (b / 0.6), contrast around 0.5, saturation mix with
 * Rec.601 luma, rounding to 8 bits.
 */

export const SCENE_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=2) in vec2 a_texCoord;
layout(location=3) in float a_textureId;
layout(location=4) in float a_hslColor;
layout(location=6) in float a_alpha;
layout(location=7) in float a_faceBias;
uniform mat4 u_mvp;
uniform float u_zBias;
uniform vec4 u_textureAnimations[128];
uniform float u_textureAnimTime;
out vec2 v_texCoord;
flat out float v_textureId;
out vec4 v_color;

const float PALETTE_GAMMA = 0.6;

vec2 animatedUvOffset(int layer) {
  if (layer <= 0 || layer >= 256) return vec2(0.0);
  vec4 pair = u_textureAnimations[layer >> 1];
  vec2 dir = (layer & 1) == 0 ? pair.xy : pair.zw;
  return u_textureAnimTime * dir / 128.0;
}

vec3 osrsHslToRgb(int hsl) {
  float hue = float(hsl >> 10) / 64.0 + 0.0078125;
  float sat = float((hsl >> 7) & 7) / 8.0 + 0.0625;
  float lum = float(hsl & 127) / 128.0;
  vec3 ramp;
  if (hue < 1.0 / 3.0) {
    ramp = vec3(6.0 * (1.0 / 3.0 - hue), 6.0 * hue, 0.0);
  } else if (hue < 2.0 / 3.0) {
    ramp = vec3(0.0, 6.0 * (2.0 / 3.0 - hue), 6.0 * (hue - 1.0 / 3.0));
  } else {
    ramp = vec3(6.0 * (hue - 2.0 / 3.0), 0.0, 6.0 * (1.0 - hue));
  }
  ramp = min(ramp, vec3(1.0));
  vec3 chroma = 2.0 * sat * ramp + (1.0 - sat);
  vec3 rgb = lum < 0.5 ? lum * chroma : (1.0 - lum) * chroma + (2.0 * lum - 1.0);
  return pow(rgb, vec3(PALETTE_GAMMA));
}

void main() {
  vec4 clip = u_mvp * vec4(a_position, 1.0);
  clip.z += u_zBias * clip.w;
  clip.z += a_faceBias / 128.0;
  gl_Position = clip;
  v_texCoord = a_texCoord + animatedUvOffset(int(a_textureId));
  v_textureId = a_textureId;
  int hsl = int(a_hslColor);
  if (a_textureId < 0.5) {
    v_color = vec4(osrsHslToRgb(hsl), a_alpha);
  } else {
    v_color = vec4(vec3(float(hsl & 127) / 127.0), a_alpha);
  }
}
`

export const SCENE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
flat in float v_textureId;
in vec4 v_color;
uniform highp sampler2DArray u_textures;
uniform float u_hasTextures;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_discardAlpha;
out vec4 fragColor;

const float PALETTE_GAMMA = 0.6;
const float DEFAULT_BRIGHTNESS = 0.6;

void main() {
  vec4 color;
  if (v_textureId > 0.0 && u_hasTextures > 0.5) {
    vec4 texel = texture(u_textures, vec3(v_texCoord, v_textureId)).bgra;
    if (texel.a < 1.0) discard;
    color = vec4(pow(texel.rgb, vec3(PALETTE_GAMMA)) * v_color.rgb, v_color.a);
  } else {
    color = v_color;
  }
  if (u_discardAlpha > 0.5 && color.a < 0.01) discard;
  color.rgb *= u_brightness / DEFAULT_BRIGHTNESS;
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(luma), color.rgb, u_saturation);
  color.rgb = round(color.rgb * 255.0) / 255.0;
  fragColor = color;
}
`
