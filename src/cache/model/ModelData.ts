// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// OSRS model decoder. Supports the four on-disk layouts still present in the
// build-240 cache, detected by the trailing footer bytes:
//   -3,-1  newest (26-byte header, animaya bone weights, texture types 0..3)
//   -2,-1  (23-byte header, animaya bone weights, textures via colour field)
//   -1,-1  (23-byte header, textured faces, no animaya)
//   none   legacy 18-byte header
// RS3-only branches (particles, billboards, versioned texture scales) are not ported.

import { ByteReader } from '../ByteReader'
import { adjustLightness, clampLightness } from './ColorPalette'
import { SINE, COSINE } from './MathTables'
import { Model } from './Model'

export interface VertexNormal {
  x: number
  y: number
  z: number
  magnitude: number
}

export interface FaceNormal {
  x: number
  y: number
  z: number
}

export class ModelData {
  /** Decoder that produced this model (3, 2, 1 or 0 for the legacy layout; 12 for merged). */
  version = -1

  vertexCount = 0
  /** Number of vertices actually referenced by faces (legacy formats may have trailing unused ones). */
  usedVertexCount = 0
  verticesX: Int32Array = new Int32Array(0)
  verticesY: Int32Array = new Int32Array(0)
  verticesZ: Int32Array = new Int32Array(0)

  faceCount = 0
  indices1: Int32Array = new Int32Array(0)
  indices2: Int32Array = new Int32Array(0)
  indices3: Int32Array = new Int32Array(0)

  /** Per-face render type (0 smooth, 1 flat, 2 hidden, 3 unlit), undefined = all 0. */
  faceRenderTypes: Int8Array | undefined
  /** Per-face render priority; undefined when the whole model shares `priority`. */
  faceRenderPriorities: Int8Array | undefined
  /** Model-wide priority used when `faceRenderPriorities` is undefined. */
  priority = 0
  /** Per-face alpha (0 = opaque, 255 transparent; -1/-2 are render-type sentinels). */
  faceAlphas: Int8Array | undefined
  /** Packed HSL16 face colours. */
  faceColors: Uint16Array = new Uint16Array(0)
  /** Per-face texture id, -1 = none. */
  faceTextures: Int16Array | undefined
  /** Per-face index into the texture mapping triangles, -1 = use the face's own vertices. */
  textureCoords: Int8Array | undefined

  textureFaceCount = 0
  textureRenderTypes: Int8Array = new Int8Array(0)
  textureMappingP: Int16Array = new Int16Array(0)
  textureMappingM: Int16Array = new Int16Array(0)
  textureMappingN: Int16Array = new Int16Array(0)
  textureScaleX: Int32Array = new Int32Array(0)
  textureScaleY: Int32Array = new Int32Array(0)
  textureScaleZ: Int32Array = new Int32Array(0)
  textureRotation: Int32Array = new Int32Array(0)
  textureDirection: Int8Array = new Int8Array(0)
  textureSpeed: Int32Array = new Int32Array(0)
  textureTransU: Int32Array = new Int32Array(0)

  /** Legacy animation labels ("skins"), -1 = unlabelled. */
  vertexSkins: Int32Array | undefined
  faceSkins: Int32Array | undefined
  private vertexLabelsCache: Int32Array[] | undefined
  private faceLabelsCache: Int32Array[] | undefined

  /** Animaya (skeletal) bone indices and 0..255 weights per vertex. */
  animMayaGroups: Int32Array[] | undefined
  animMayaScales: Int32Array[] | undefined

  private normals: VertexNormal[] | undefined
  private faceNormals: FaceNormal[] | undefined

  // ---------------------------------------------------------------- decoding

  static decode(data: Uint8Array): ModelData {
    const model = new ModelData()
    const last = data[data.length - 1]
    const secondLast = data[data.length - 2]
    if (last === 0xfd && secondLast === 0xff) {
      model.decodeNewest(data)
    } else if (last === 0xfe && secondLast === 0xff) {
      model.decodeV2(data)
    } else if (last === 0xff && secondLast === 0xff) {
      model.decodeV1(data)
    } else {
      model.decodeOld(data)
    }
    return model
  }

  /** Newest layout (footer -3,-1): 26-byte header with animaya groups and texture types 0..3. */
  private decodeNewest(data: Uint8Array): void {
    this.version = 3
    const header = new ByteReader(data, data.length - 26)
    const vertexCount = header.u16()
    const faceCount = header.u16()
    const texFaceCount = header.u8()
    const hasFaceRenderTypes = header.u8() === 1
    const modelPriority = header.u8()
    const hasFaceAlphas = header.u8() === 1
    const hasFaceSkins = header.u8() === 1
    const hasFaceTextures = header.u8() === 1
    const hasVertexSkins = header.u8() === 1
    const hasMayaGroups = header.u8() === 1
    const vertexXBytes = header.u16()
    const vertexYBytes = header.u16()
    const vertexZBytes = header.u16()
    const faceIndexBytes = header.u16()
    const textureIndexBytes = header.u16()
    const skinBytes = header.u16()

    let simpleTexCount = 0
    let complexTexCount = 0
    let cubeTexCount = 0
    if (texFaceCount > 0) {
      this.textureRenderTypes = new Int8Array(texFaceCount)
      const r = new ByteReader(data, 0)
      for (let i = 0; i < texFaceCount; i++) {
        const type = (this.textureRenderTypes[i] = r.i8())
        if (type === 0) simpleTexCount++
        if (type >= 1 && type <= 3) complexTexCount++
        if (type === 2) cubeTexCount++
      }
    }

    let off = texFaceCount + vertexCount
    const faceRenderTypesOff = off
    if (hasFaceRenderTypes) off += faceCount
    const faceCompressTypeOff = off
    off += faceCount
    const facePrioritiesOff = off
    if (modelPriority === 255) off += faceCount
    const faceSkinsOff = off
    if (hasFaceSkins) off += faceCount
    const skinsOff = off
    off += skinBytes
    const faceAlphasOff = off
    if (hasFaceAlphas) off += faceCount
    const faceIndicesOff = off
    off += faceIndexBytes
    const faceTexturesOff = off
    if (hasFaceTextures) off += faceCount * 2
    const textureCoordsOff = off
    off += textureIndexBytes
    const faceColorsOff = off
    off += faceCount * 2
    const vertexXOff = off
    off += vertexXBytes
    const vertexYOff = off
    off += vertexYBytes
    const vertexZOff = off
    off += vertexZBytes
    const simpleTexOff = off
    off += simpleTexCount * 6
    const complexTexOff = off
    off += complexTexCount * 6
    const texScaleOff = off
    off += complexTexCount * 6
    const texRotationOff = off
    off += complexTexCount * 2
    const texDirectionOff = off
    off += complexTexCount
    const texTranslationOff = off
    off += complexTexCount * 2 + cubeTexCount * 2

    this.allocate(vertexCount, faceCount, texFaceCount, complexTexCount, cubeTexCount)
    if (hasVertexSkins) this.vertexSkins = new Int32Array(vertexCount)
    if (hasFaceRenderTypes) this.faceRenderTypes = new Int8Array(faceCount)
    if (modelPriority === 255) {
      this.faceRenderPriorities = new Int8Array(faceCount)
    } else {
      this.priority = modelPriority
    }
    if (hasFaceAlphas) this.faceAlphas = new Int8Array(faceCount)
    if (hasFaceSkins) this.faceSkins = new Int32Array(faceCount)
    if (hasFaceTextures) this.faceTextures = new Int16Array(faceCount)
    if (hasFaceTextures && texFaceCount > 0) this.textureCoords = new Int8Array(faceCount)
    if (hasMayaGroups) {
      this.animMayaGroups = new Array<Int32Array>(vertexCount)
      this.animMayaScales = new Array<Int32Array>(vertexCount)
    }

    const skinReader = new ByteReader(data, skinsOff)
    this.readVertices(
      data,
      texFaceCount,
      vertexXOff,
      vertexYOff,
      vertexZOff,
      hasVertexSkins ? skinReader : undefined,
    )

    if (hasMayaGroups) {
      const groups = this.animMayaGroups!
      const scales = this.animMayaScales!
      for (let i = 0; i < vertexCount; i++) {
        const n = skinReader.u8()
        const g = (groups[i] = new Int32Array(n))
        const s = (scales[i] = new Int32Array(n))
        for (let j = 0; j < n; j++) {
          g[j] = skinReader.u8()
          s[j] = skinReader.u8()
        }
      }
    }

    const colors = new ByteReader(data, faceColorsOff)
    const renderTypes = new ByteReader(data, faceRenderTypesOff)
    const priorities = new ByteReader(data, facePrioritiesOff)
    const alphas = new ByteReader(data, faceAlphasOff)
    const faceSkins = new ByteReader(data, faceSkinsOff)
    const textures = new ByteReader(data, faceTexturesOff)
    const texCoords = new ByteReader(data, textureCoordsOff)
    for (let i = 0; i < faceCount; i++) {
      this.faceColors[i] = colors.u16()
      if (this.faceRenderTypes) this.faceRenderTypes[i] = renderTypes.i8()
      if (this.faceRenderPriorities) this.faceRenderPriorities[i] = priorities.i8()
      if (this.faceAlphas) this.faceAlphas[i] = alphas.i8()
      if (this.faceSkins) this.faceSkins[i] = faceSkins.u8()
      if (this.faceTextures) this.faceTextures[i] = textures.u16() - 1
      if (this.textureCoords) {
        if (this.faceTextures && this.faceTextures[i] !== -1) {
          this.textureCoords[i] = texCoords.u8() - 1
        } else {
          this.textureCoords[i] = -1
        }
      }
    }

    this.readFaces(data, faceIndicesOff, faceCompressTypeOff)
    this.usedVertexCount = vertexCount

    this.readTextureMapping(
      data,
      simpleTexOff,
      complexTexOff,
      texScaleOff,
      texRotationOff,
      texDirectionOff,
      texTranslationOff,
    )
  }

  /** Footer -2,-1: 23-byte header, textures encoded through the colour field, animaya groups. */
  private decodeV2(data: Uint8Array): void {
    this.version = 2
    const header = new ByteReader(data, data.length - 23)
    const vertexCount = header.u16()
    const faceCount = header.u16()
    const texFaceCount = header.u8()
    const usesTextures = header.u8() === 1
    const modelPriority = header.u8()
    const hasFaceAlphas = header.u8() === 1
    const hasFaceSkins = header.u8() === 1
    const hasVertexSkins = header.u8() === 1
    const hasMayaGroups = header.u8() === 1
    const vertexXBytes = header.u16()
    const vertexYBytes = header.u16()
    header.u16() // vertexZBytes
    const faceIndexBytes = header.u16()
    const skinBytes = header.u16()

    let off = vertexCount
    const faceCompressTypeOff = off
    off += faceCount
    const facePrioritiesOff = off
    if (modelPriority === 255) off += faceCount
    const faceSkinsOff = off
    if (hasFaceSkins) off += faceCount
    const faceInfoOff = off
    if (usesTextures) off += faceCount
    const skinsOff = off
    off += skinBytes
    const faceAlphasOff = off
    if (hasFaceAlphas) off += faceCount
    const faceIndicesOff = off
    off += faceIndexBytes
    const faceColorsOff = off
    off += faceCount * 2
    const texMappingOff = off
    off += texFaceCount * 6
    const vertexXOff = off
    off += vertexXBytes
    const vertexYOff = off
    off += vertexYBytes
    const vertexZOff = off

    this.allocate(vertexCount, faceCount, texFaceCount, 0, 0)
    if (hasVertexSkins) this.vertexSkins = new Int32Array(vertexCount)
    if (usesTextures) {
      this.faceRenderTypes = new Int8Array(faceCount)
      this.textureCoords = new Int8Array(faceCount)
      this.faceTextures = new Int16Array(faceCount)
    }
    if (modelPriority === 255) {
      this.faceRenderPriorities = new Int8Array(faceCount)
    } else {
      this.priority = modelPriority
    }
    if (hasFaceAlphas) this.faceAlphas = new Int8Array(faceCount)
    if (hasFaceSkins) this.faceSkins = new Int32Array(faceCount)
    if (hasMayaGroups) {
      this.animMayaGroups = new Array<Int32Array>(vertexCount)
      this.animMayaScales = new Array<Int32Array>(vertexCount)
    }

    const skinReader = new ByteReader(data, skinsOff)
    this.readVertices(data, 0, vertexXOff, vertexYOff, vertexZOff, hasVertexSkins ? skinReader : undefined)
    if (hasMayaGroups) {
      const groups = this.animMayaGroups!
      const scales = this.animMayaScales!
      for (let i = 0; i < vertexCount; i++) {
        const n = skinReader.u8()
        const g = (groups[i] = new Int32Array(n))
        const s = (scales[i] = new Int32Array(n))
        for (let j = 0; j < n; j++) {
          g[j] = skinReader.u8()
          s[j] = skinReader.u8()
        }
      }
    }

    this.readFacesLegacyInfo(
      data,
      faceColorsOff,
      faceInfoOff,
      facePrioritiesOff,
      faceAlphasOff,
      faceSkinsOff,
      usesTextures,
    )
    this.readFaces(data, faceIndicesOff, faceCompressTypeOff)
    this.usedVertexCount = vertexCount
    this.readLegacyTextureMapping(data, texMappingOff)
  }

  /** Footer -1,-1: 23-byte header, explicit face textures, texture types 0..3, no animaya. */
  private decodeV1(data: Uint8Array): void {
    this.version = 1
    const header = new ByteReader(data, data.length - 23)
    const vertexCount = header.u16()
    const faceCount = header.u16()
    const texFaceCount = header.u8()
    const hasFaceRenderTypes = header.u8() === 1
    const modelPriority = header.u8()
    const hasFaceAlphas = header.u8() === 1
    const hasFaceSkins = header.u8() === 1
    const hasFaceTextures = header.u8() === 1
    const hasVertexSkins = header.u8() === 1
    const vertexXBytes = header.u16()
    const vertexYBytes = header.u16()
    const vertexZBytes = header.u16()
    const faceIndexBytes = header.u16()
    const textureIndexBytes = header.u16()

    let simpleTexCount = 0
    let complexTexCount = 0
    let cubeTexCount = 0
    if (texFaceCount > 0) {
      this.textureRenderTypes = new Int8Array(texFaceCount)
      const r = new ByteReader(data, 0)
      for (let i = 0; i < texFaceCount; i++) {
        const type = (this.textureRenderTypes[i] = r.i8())
        if (type === 0) simpleTexCount++
        if (type >= 1 && type <= 3) complexTexCount++
        if (type === 2) cubeTexCount++
      }
    }

    let off = texFaceCount + vertexCount
    const faceRenderTypesOff = off
    if (hasFaceRenderTypes) off += faceCount
    const faceCompressTypeOff = off
    off += faceCount
    const facePrioritiesOff = off
    if (modelPriority === 255) off += faceCount
    const faceSkinsOff = off
    if (hasFaceSkins) off += faceCount
    const vertexSkinsOff = off
    if (hasVertexSkins) off += vertexCount
    const faceAlphasOff = off
    if (hasFaceAlphas) off += faceCount
    const faceIndicesOff = off
    off += faceIndexBytes
    const faceTexturesOff = off
    if (hasFaceTextures) off += faceCount * 2
    const textureCoordsOff = off
    off += textureIndexBytes
    const faceColorsOff = off
    off += faceCount * 2
    const vertexXOff = off
    off += vertexXBytes
    const vertexYOff = off
    off += vertexYBytes
    const vertexZOff = off
    off += vertexZBytes
    const simpleTexOff = off
    off += simpleTexCount * 6
    const complexTexOff = off
    off += complexTexCount * 6
    const texScaleOff = off
    off += complexTexCount * 6
    const texRotationOff = off
    off += complexTexCount * 2
    const texDirectionOff = off
    off += complexTexCount
    const texTranslationOff = off
    off += complexTexCount * 2 + cubeTexCount * 2

    this.allocate(vertexCount, faceCount, texFaceCount, complexTexCount, cubeTexCount)
    if (hasVertexSkins) this.vertexSkins = new Int32Array(vertexCount)
    if (hasFaceRenderTypes) this.faceRenderTypes = new Int8Array(faceCount)
    if (modelPriority === 255) {
      this.faceRenderPriorities = new Int8Array(faceCount)
    } else {
      this.priority = modelPriority
    }
    if (hasFaceAlphas) this.faceAlphas = new Int8Array(faceCount)
    if (hasFaceSkins) this.faceSkins = new Int32Array(faceCount)
    if (hasFaceTextures) this.faceTextures = new Int16Array(faceCount)
    if (hasFaceTextures && texFaceCount > 0) this.textureCoords = new Int8Array(faceCount)

    this.readVertices(
      data,
      texFaceCount,
      vertexXOff,
      vertexYOff,
      vertexZOff,
      hasVertexSkins ? new ByteReader(data, vertexSkinsOff) : undefined,
    )

    const colors = new ByteReader(data, faceColorsOff)
    const renderTypes = new ByteReader(data, faceRenderTypesOff)
    const priorities = new ByteReader(data, facePrioritiesOff)
    const alphas = new ByteReader(data, faceAlphasOff)
    const faceSkins = new ByteReader(data, faceSkinsOff)
    const textures = new ByteReader(data, faceTexturesOff)
    const texCoords = new ByteReader(data, textureCoordsOff)
    for (let i = 0; i < faceCount; i++) {
      this.faceColors[i] = colors.u16()
      if (this.faceRenderTypes) this.faceRenderTypes[i] = renderTypes.i8()
      if (this.faceRenderPriorities) this.faceRenderPriorities[i] = priorities.i8()
      if (this.faceAlphas) this.faceAlphas[i] = alphas.i8()
      if (this.faceSkins) this.faceSkins[i] = faceSkins.u8()
      if (this.faceTextures) this.faceTextures[i] = textures.u16() - 1
      if (this.textureCoords) {
        if (this.faceTextures && this.faceTextures[i] !== -1) {
          this.textureCoords[i] = texCoords.u8() - 1
        } else {
          this.textureCoords[i] = -1
        }
      }
    }

    this.usedVertexCount = this.readFaces(data, faceIndicesOff, faceCompressTypeOff) + 1
    this.readTextureMapping(
      data,
      simpleTexOff,
      complexTexOff,
      texScaleOff,
      texRotationOff,
      texDirectionOff,
      texTranslationOff,
    )
  }

  /** No footer: legacy 18-byte header. */
  private decodeOld(data: Uint8Array): void {
    this.version = 0
    const header = new ByteReader(data, data.length - 18)
    const vertexCount = header.u16()
    const faceCount = header.u16()
    const texFaceCount = header.u8()
    const usesTextures = header.u8() === 1
    const modelPriority = header.u8()
    const hasFaceAlphas = header.u8() === 1
    const hasFaceSkins = header.u8() === 1
    const hasVertexSkins = header.u8() === 1
    const vertexXBytes = header.u16()
    const vertexYBytes = header.u16()
    header.u16() // vertexZBytes
    const faceIndexBytes = header.u16()

    let off = vertexCount
    const faceCompressTypeOff = off
    off += faceCount
    const facePrioritiesOff = off
    if (modelPriority === 255) off += faceCount
    const faceSkinsOff = off
    if (hasFaceSkins) off += faceCount
    const faceInfoOff = off
    if (usesTextures) off += faceCount
    const vertexSkinsOff = off
    if (hasVertexSkins) off += vertexCount
    const faceAlphasOff = off
    if (hasFaceAlphas) off += faceCount
    const faceIndicesOff = off
    off += faceIndexBytes
    const faceColorsOff = off
    off += faceCount * 2
    const texMappingOff = off
    off += texFaceCount * 6
    const vertexXOff = off
    off += vertexXBytes
    const vertexYOff = off
    off += vertexYBytes
    const vertexZOff = off

    this.allocate(vertexCount, faceCount, texFaceCount, 0, 0)
    if (hasVertexSkins) this.vertexSkins = new Int32Array(vertexCount)
    if (usesTextures) {
      this.faceRenderTypes = new Int8Array(faceCount)
      this.textureCoords = new Int8Array(faceCount)
      this.faceTextures = new Int16Array(faceCount)
    }
    if (modelPriority === 255) {
      this.faceRenderPriorities = new Int8Array(faceCount)
    } else {
      this.priority = modelPriority
    }
    if (hasFaceAlphas) this.faceAlphas = new Int8Array(faceCount)
    if (hasFaceSkins) this.faceSkins = new Int32Array(faceCount)

    this.readVertices(
      data,
      0,
      vertexXOff,
      vertexYOff,
      vertexZOff,
      hasVertexSkins ? new ByteReader(data, vertexSkinsOff) : undefined,
    )
    this.readFacesLegacyInfo(
      data,
      faceColorsOff,
      faceInfoOff,
      facePrioritiesOff,
      faceAlphasOff,
      faceSkinsOff,
      usesTextures,
    )
    this.usedVertexCount = this.readFaces(data, faceIndicesOff, faceCompressTypeOff) + 1
    this.readLegacyTextureMapping(data, texMappingOff)
  }

  private allocate(
    vertexCount: number,
    faceCount: number,
    texFaceCount: number,
    complexTexCount: number,
    cubeTexCount: number,
  ): void {
    this.vertexCount = vertexCount
    this.faceCount = faceCount
    this.textureFaceCount = texFaceCount
    this.verticesX = new Int32Array(vertexCount)
    this.verticesY = new Int32Array(vertexCount)
    this.verticesZ = new Int32Array(vertexCount)
    this.indices1 = new Int32Array(faceCount)
    this.indices2 = new Int32Array(faceCount)
    this.indices3 = new Int32Array(faceCount)
    this.faceColors = new Uint16Array(faceCount)
    if (texFaceCount > 0) {
      if (this.textureRenderTypes.length !== texFaceCount) {
        this.textureRenderTypes = new Int8Array(texFaceCount)
      }
      this.textureMappingP = new Int16Array(texFaceCount)
      this.textureMappingM = new Int16Array(texFaceCount)
      this.textureMappingN = new Int16Array(texFaceCount)
      if (complexTexCount > 0) {
        this.textureScaleX = new Int32Array(texFaceCount)
        this.textureScaleY = new Int32Array(texFaceCount)
        this.textureScaleZ = new Int32Array(texFaceCount)
        this.textureRotation = new Int32Array(texFaceCount)
        this.textureDirection = new Int8Array(texFaceCount)
        this.textureSpeed = new Int32Array(texFaceCount)
      }
      if (cubeTexCount > 0) {
        this.textureTransU = new Int32Array(texFaceCount)
      }
    }
  }

  /** Delta-encoded vertex positions: a flag byte per vertex selects which axes carry a signed smart. */
  private readVertices(
    data: Uint8Array,
    flagsOff: number,
    xOff: number,
    yOff: number,
    zOff: number,
    skins: ByteReader | undefined,
  ): void {
    const flags = new ByteReader(data, flagsOff)
    const xs = new ByteReader(data, xOff)
    const ys = new ByteReader(data, yOff)
    const zs = new ByteReader(data, zOff)
    let x = 0
    let y = 0
    let z = 0
    for (let i = 0; i < this.vertexCount; i++) {
      const flag = flags.u8()
      if ((flag & 1) !== 0) x += xs.iSmart()
      if ((flag & 2) !== 0) y += ys.iSmart()
      if ((flag & 4) !== 0) z += zs.iSmart()
      this.verticesX[i] = x
      this.verticesY[i] = y
      this.verticesZ[i] = z
      if (skins && this.vertexSkins) this.vertexSkins[i] = skins.u8()
    }
  }

  /** Face info block of the legacy/V2 formats: colour, packed render-type/texture flag, priority, alpha, skin. */
  private readFacesLegacyInfo(
    data: Uint8Array,
    colorsOff: number,
    infoOff: number,
    prioritiesOff: number,
    alphasOff: number,
    skinsOff: number,
    usesTextures: boolean,
  ): void {
    const colors = new ByteReader(data, colorsOff)
    const info = new ByteReader(data, infoOff)
    const priorities = new ByteReader(data, prioritiesOff)
    const alphas = new ByteReader(data, alphasOff)
    const skins = new ByteReader(data, skinsOff)
    let hasRenderType = false
    let isTextured = false
    for (let i = 0; i < this.faceCount; i++) {
      this.faceColors[i] = colors.u16()
      if (usesTextures && this.faceRenderTypes && this.textureCoords && this.faceTextures) {
        const flag = info.u8()
        if ((flag & 1) === 1) {
          this.faceRenderTypes[i] = 1
          hasRenderType = true
        } else {
          this.faceRenderTypes[i] = 0
        }
        if ((flag & 2) === 2) {
          this.textureCoords[i] = flag >> 2
          this.faceTextures[i] = this.faceColors[i]!
          this.faceColors[i] = 127
          if (this.faceTextures[i] !== -1) isTextured = true
        } else {
          this.textureCoords[i] = -1
          this.faceTextures[i] = -1
        }
      }
      if (this.faceRenderPriorities) this.faceRenderPriorities[i] = priorities.i8()
      if (this.faceAlphas) this.faceAlphas[i] = alphas.i8()
      if (this.faceSkins) this.faceSkins[i] = skins.u8()
    }
    if (usesTextures) {
      if (!isTextured) this.faceTextures = undefined
      if (!hasRenderType) this.faceRenderTypes = undefined
    }
  }

  /** Strip-compressed face indices. Returns the highest vertex index referenced. */
  private readFaces(data: Uint8Array, indicesOff: number, typesOff: number): number {
    const idx = new ByteReader(data, indicesOff)
    const types = new ByteReader(data, typesOff)
    let a = 0
    let b = 0
    let c = 0
    let last = 0
    let highest = -1
    for (let i = 0; i < this.faceCount; i++) {
      const type = types.u8()
      if (type === 1) {
        a = idx.iSmart() + last
        b = idx.iSmart() + a
        c = idx.iSmart() + b
        last = c
        if (a > highest) highest = a
        if (b > highest) highest = b
      } else if (type === 2) {
        b = c
        c = idx.iSmart() + last
        last = c
      } else if (type === 3) {
        a = c
        c = idx.iSmart() + last
        last = c
      } else if (type === 4) {
        const t = a
        a = b
        b = t
        c = idx.iSmart() + last
        last = c
      }
      if (c > highest) highest = c
      this.indices1[i] = a
      this.indices2[i] = b
      this.indices3[i] = c
    }
    return highest
  }

  /** Texture mapping triangles for the V1/newest layouts (types 0..3). */
  private readTextureMapping(
    data: Uint8Array,
    simpleOff: number,
    complexOff: number,
    scaleOff: number,
    rotationOff: number,
    directionOff: number,
    translationOff: number,
  ): void {
    const simple = new ByteReader(data, simpleOff)
    const complex = new ByteReader(data, complexOff)
    const scale = new ByteReader(data, scaleOff)
    const rotation = new ByteReader(data, rotationOff)
    const direction = new ByteReader(data, directionOff)
    const translation = new ByteReader(data, translationOff)
    for (let i = 0; i < this.textureFaceCount; i++) {
      const type = this.textureRenderTypes[i]! & 0xff
      if (type === 0) {
        this.textureMappingP[i] = simple.u16()
        this.textureMappingM[i] = simple.u16()
        this.textureMappingN[i] = simple.u16()
      } else if (type >= 1 && type <= 3) {
        this.textureMappingP[i] = complex.u16()
        this.textureMappingM[i] = complex.u16()
        this.textureMappingN[i] = complex.u16()
        this.textureScaleX[i] = scale.u16()
        this.textureScaleY[i] = scale.u16()
        this.textureScaleZ[i] = scale.u16()
        this.textureRotation[i] = rotation.u16()
        this.textureDirection[i] = direction.i8()
        this.textureSpeed[i] = translation.u16()
        if (type === 2) this.textureTransU[i] = translation.u16()
      }
    }
  }

  /** Legacy/V2 texture mapping: always type 0, and drop coords that equal the face itself. */
  private readLegacyTextureMapping(data: Uint8Array, mappingOff: number): void {
    const r = new ByteReader(data, mappingOff)
    for (let i = 0; i < this.textureFaceCount; i++) {
      this.textureRenderTypes[i] = 0
      this.textureMappingP[i] = r.u16()
      this.textureMappingM[i] = r.u16()
      this.textureMappingN[i] = r.u16()
    }
    if (this.textureCoords) {
      let hasValid = false
      for (let i = 0; i < this.faceCount; i++) {
        const coord = this.textureCoords[i]! & 0xff
        if (coord !== 0xff) {
          if (
            this.indices1[i] === (this.textureMappingP[coord]! & 0xffff) &&
            this.indices2[i] === (this.textureMappingM[coord]! & 0xffff) &&
            this.indices3[i] === (this.textureMappingN[coord]! & 0xffff)
          ) {
            this.textureCoords[i] = -1
          } else {
            hasValid = true
          }
        }
      }
      if (!hasValid) this.textureCoords = undefined
    }
  }

  // ---------------------------------------------------------------- assembly

  /** Merge several models into one, de-duplicating vertices by position (as the client does). */
  static merge(models: readonly (ModelData | undefined)[]): ModelData {
    const out = new ModelData()
    out.version = 12
    out.priority = -1

    let vertexCount = 0
    let faceCount = 0
    let texFaceCount = 0
    let hasRenderTypes = false
    let hasRenderPriorities = false
    let hasAlphas = false
    let hasFaceSkins = false
    let hasTextures = false
    let hasTextureCoords = false
    let hasMayaGroups = false
    let hasVertexSkins = false

    for (const model of models) {
      if (!model) continue
      vertexCount += model.vertexCount
      faceCount += model.faceCount
      texFaceCount += model.textureFaceCount
      if (model.faceRenderPriorities) {
        hasRenderPriorities = true
      } else {
        if (out.priority === -1) out.priority = model.priority
        if (out.priority !== model.priority) hasRenderPriorities = true
      }
      hasRenderTypes ||= !!model.faceRenderTypes
      hasAlphas ||= !!model.faceAlphas
      hasFaceSkins ||= !!model.faceSkins
      hasTextures ||= !!model.faceTextures
      hasTextureCoords ||= !!model.textureCoords
      hasMayaGroups ||= !!model.animMayaGroups
      hasVertexSkins ||= !!model.vertexSkins
    }
    if (out.priority === -1) out.priority = 0

    out.verticesX = new Int32Array(vertexCount)
    out.verticesY = new Int32Array(vertexCount)
    out.verticesZ = new Int32Array(vertexCount)
    if (hasVertexSkins) out.vertexSkins = new Int32Array(vertexCount)
    out.indices1 = new Int32Array(faceCount)
    out.indices2 = new Int32Array(faceCount)
    out.indices3 = new Int32Array(faceCount)
    out.faceColors = new Uint16Array(faceCount)
    if (hasRenderTypes) out.faceRenderTypes = new Int8Array(faceCount)
    if (hasRenderPriorities) out.faceRenderPriorities = new Int8Array(faceCount)
    if (hasAlphas) out.faceAlphas = new Int8Array(faceCount)
    if (hasFaceSkins) out.faceSkins = new Int32Array(faceCount)
    if (hasTextures) out.faceTextures = new Int16Array(faceCount)
    if (hasTextureCoords) out.textureCoords = new Int8Array(faceCount)
    if (hasMayaGroups) {
      out.animMayaGroups = new Array<Int32Array>(vertexCount)
      out.animMayaScales = new Array<Int32Array>(vertexCount)
    }
    if (texFaceCount > 0) {
      out.textureRenderTypes = new Int8Array(texFaceCount)
      out.textureMappingP = new Int16Array(texFaceCount)
      out.textureMappingM = new Int16Array(texFaceCount)
      out.textureMappingN = new Int16Array(texFaceCount)
      out.textureScaleX = new Int32Array(texFaceCount)
      out.textureScaleY = new Int32Array(texFaceCount)
      out.textureScaleZ = new Int32Array(texFaceCount)
      out.textureRotation = new Int32Array(texFaceCount)
      out.textureDirection = new Int8Array(texFaceCount)
      out.textureSpeed = new Int32Array(texFaceCount)
      out.textureTransU = new Int32Array(texFaceCount)
    }

    const lookup = new Map<string, number>()
    out.vertexCount = 0
    out.faceCount = 0
    out.textureFaceCount = 0

    for (const model of models) {
      if (!model) continue
      const vertexMap = new Int32Array(model.vertexCount).fill(-1)
      const mapVertex = (index: number): number => {
        const cached = vertexMap[index]!
        if (cached !== -1) return cached
        const mapped = out.copyVertex(model, index, lookup)
        vertexMap[index] = mapped
        return mapped
      }

      for (let f = 0; f < model.faceCount; f++) {
        const o = out.faceCount
        if (out.faceRenderTypes) {
          out.faceRenderTypes[o] = model.faceRenderTypes ? model.faceRenderTypes[f]! : 0
        }
        if (out.faceRenderPriorities) {
          out.faceRenderPriorities[o] = model.faceRenderPriorities
            ? model.faceRenderPriorities[f]!
            : model.priority
        }
        if (out.faceAlphas) out.faceAlphas[o] = model.faceAlphas ? model.faceAlphas[f]! : 0
        if (out.faceSkins) out.faceSkins[o] = model.faceSkins ? model.faceSkins[f]! : -1
        if (out.faceTextures) out.faceTextures[o] = model.faceTextures ? model.faceTextures[f]! : -1
        if (out.textureCoords) {
          if (model.textureCoords && model.textureCoords[f] !== -1) {
            out.textureCoords[o] = out.textureFaceCount + model.textureCoords[f]!
          } else {
            out.textureCoords[o] = -1
          }
        }
        out.faceColors[o] = model.faceColors[f]!
        out.indices1[o] = mapVertex(model.indices1[f]!)
        out.indices2[o] = mapVertex(model.indices2[f]!)
        out.indices3[o] = mapVertex(model.indices3[f]!)
        out.faceCount++
      }

      for (let t = 0; t < model.textureFaceCount; t++) {
        const o = out.textureFaceCount
        const type = (out.textureRenderTypes[o] = model.textureRenderTypes[t]!)
        if (type === 0) {
          out.textureMappingP[o] = mapVertex(model.textureMappingP[t]! & 0xffff)
          out.textureMappingM[o] = mapVertex(model.textureMappingM[t]! & 0xffff)
          out.textureMappingN[o] = mapVertex(model.textureMappingN[t]! & 0xffff)
        } else if (type >= 1 && type <= 3) {
          out.textureMappingP[o] = model.textureMappingP[t]!
          out.textureMappingM[o] = model.textureMappingM[t]!
          out.textureMappingN[o] = model.textureMappingN[t]!
          out.textureScaleX[o] = model.textureScaleX[t] ?? 0
          out.textureScaleY[o] = model.textureScaleY[t] ?? 0
          out.textureScaleZ[o] = model.textureScaleZ[t] ?? 0
          out.textureRotation[o] = model.textureRotation[t] ?? 0
          out.textureDirection[o] = model.textureDirection[t] ?? 0
          out.textureSpeed[o] = model.textureSpeed[t] ?? 0
          if (type === 2) out.textureTransU[o] = model.textureTransU[t] ?? 0
        }
        out.textureFaceCount++
      }
    }

    out.usedVertexCount = out.vertexCount
    return out
  }

  private copyVertex(model: ModelData, index: number, lookup: Map<string, number>): number {
    const x = model.verticesX[index]!
    const y = model.verticesY[index]!
    const z = model.verticesZ[index]!
    const key = `${x},${y},${z}`
    const existing = lookup.get(key)
    if (existing !== undefined) return existing

    const v = this.vertexCount++
    this.verticesX[v] = x
    this.verticesY[v] = y
    this.verticesZ[v] = z
    if (this.vertexSkins) this.vertexSkins[v] = model.vertexSkins ? model.vertexSkins[index]! : -1
    if (this.animMayaGroups && this.animMayaScales) {
      if (model.animMayaGroups && model.animMayaScales) {
        this.animMayaGroups[v] = model.animMayaGroups[index] ?? new Int32Array(0)
        this.animMayaScales[v] = model.animMayaScales[index] ?? new Int32Array(0)
      } else {
        this.animMayaGroups[v] = new Int32Array(0)
        this.animMayaScales[v] = new Int32Array(0)
      }
    }
    lookup.set(key, v)
    return v
  }

  /** Deep copy of everything an in-place transform or animation may mutate. */
  copy(): ModelData {
    const m = new ModelData()
    m.version = this.version
    m.vertexCount = this.vertexCount
    m.usedVertexCount = this.usedVertexCount
    m.verticesX = this.verticesX.slice()
    m.verticesY = this.verticesY.slice()
    m.verticesZ = this.verticesZ.slice()
    m.faceCount = this.faceCount
    m.indices1 = this.indices1.slice()
    m.indices2 = this.indices2.slice()
    m.indices3 = this.indices3.slice()
    m.faceRenderTypes = this.faceRenderTypes?.slice()
    m.faceRenderPriorities = this.faceRenderPriorities?.slice()
    m.priority = this.priority
    m.faceAlphas = this.faceAlphas?.slice()
    m.faceColors = this.faceColors.slice()
    m.faceTextures = this.faceTextures?.slice()
    m.textureCoords = this.textureCoords?.slice()
    m.textureFaceCount = this.textureFaceCount
    m.textureRenderTypes = this.textureRenderTypes
    m.textureMappingP = this.textureMappingP
    m.textureMappingM = this.textureMappingM
    m.textureMappingN = this.textureMappingN
    m.textureScaleX = this.textureScaleX
    m.textureScaleY = this.textureScaleY
    m.textureScaleZ = this.textureScaleZ
    m.textureRotation = this.textureRotation
    m.textureDirection = this.textureDirection
    m.textureSpeed = this.textureSpeed
    m.textureTransU = this.textureTransU
    m.vertexSkins = this.vertexSkins
    m.faceSkins = this.faceSkins
    m.animMayaGroups = this.animMayaGroups
    m.animMayaScales = this.animMayaScales
    return m
  }

  // ---------------------------------------------------------------- transforms (in place)

  rotate90(): void {
    for (let i = 0; i < this.vertexCount; i++) {
      const x = this.verticesX[i]!
      this.verticesX[i] = this.verticesZ[i]!
      this.verticesZ[i] = -x
    }
    this.invalidate()
  }

  rotate180(): void {
    for (let i = 0; i < this.vertexCount; i++) {
      this.verticesX[i] = -this.verticesX[i]!
      this.verticesZ[i] = -this.verticesZ[i]!
    }
    this.invalidate()
  }

  rotate270(): void {
    for (let i = 0; i < this.vertexCount; i++) {
      const z = this.verticesZ[i]!
      this.verticesZ[i] = this.verticesX[i]!
      this.verticesX[i] = -z
    }
    this.invalidate()
  }

  /** Rotate around Y by an angle in 1/2048ths of a turn. */
  rotate(angle: number): void {
    const sin = SINE[angle & 0x7ff]!
    const cos = COSINE[angle & 0x7ff]!
    for (let i = 0; i < this.vertexCount; i++) {
      const x = this.verticesX[i]!
      const z = this.verticesZ[i]!
      this.verticesX[i] = (sin * z + cos * x) >> 16
      this.verticesZ[i] = (cos * z - sin * x) >> 16
    }
    this.invalidate()
  }

  translate(x: number, y: number, z: number): void {
    for (let i = 0; i < this.vertexCount; i++) {
      this.verticesX[i] = this.verticesX[i]! + x
      this.verticesY[i] = this.verticesY[i]! + y
      this.verticesZ[i] = this.verticesZ[i]! + z
    }
    this.invalidate()
  }

  /** Scale by 128ths (128 = unchanged). */
  scale(x: number, y: number, z: number): void {
    for (let i = 0; i < this.vertexCount; i++) {
      this.verticesX[i] = ((this.verticesX[i]! * x) / 128) | 0
      this.verticesY[i] = ((this.verticesY[i]! * y) / 128) | 0
      this.verticesZ[i] = ((this.verticesZ[i]! * z) / 128) | 0
    }
    this.invalidate()
  }

  recolor(from: number, to: number): void {
    for (let i = 0; i < this.faceCount; i++) {
      if (this.faceColors[i] === from) this.faceColors[i] = to
    }
  }

  /** Apply a list of (from, to) HSL16 pairs, e.g. an NPC's `recolorFrom`/`recolorTo`. */
  replaceColors(from: readonly number[], to: readonly number[]): void {
    for (let i = 0; i < from.length; i++) this.recolor(from[i]!, to[i]!)
  }

  retexture(from: number, to: number): void {
    if (!this.faceTextures) return
    for (let i = 0; i < this.faceCount; i++) {
      if (this.faceTextures[i] === from) this.faceTextures[i] = to
    }
  }

  replaceTextures(from: readonly number[], to: readonly number[]): void {
    for (let i = 0; i < from.length; i++) this.retexture(from[i]!, to[i]!)
  }

  /** Mirror along Z (flips winding so faces stay front-facing). */
  mirror(): void {
    for (let i = 0; i < this.vertexCount; i++) {
      this.verticesZ[i] = -this.verticesZ[i]!
    }
    for (let i = 0; i < this.faceCount; i++) {
      const a = this.indices1[i]!
      this.indices1[i] = this.indices3[i]!
      this.indices3[i] = a
    }
    this.invalidate()
  }

  invalidate(): void {
    this.normals = undefined
    this.faceNormals = undefined
  }

  // ---------------------------------------------------------------- animation tables

  /** Vertex indices grouped by skin label (built lazily, cached). */
  get vertexLabels(): Int32Array[] {
    if (!this.vertexLabelsCache) {
      this.vertexLabelsCache = this.vertexSkins
        ? groupByLabel(this.vertexSkins, this.usedVertexCount)
        : []
    }
    return this.vertexLabelsCache
  }

  /** Face indices grouped by skin label (built lazily, cached). */
  get faceLabels(): Int32Array[] {
    if (!this.faceLabelsCache) {
      this.faceLabelsCache = this.faceSkins ? groupByLabel(this.faceSkins, this.faceCount) : []
    }
    return this.faceLabelsCache
  }

  get hasLegacyAnimation(): boolean {
    return this.vertexSkins !== undefined
  }

  get hasSkeletalAnimation(): boolean {
    return this.animMayaGroups !== undefined
  }

  // ---------------------------------------------------------------- lighting

  calculateVertexNormals(): VertexNormal[] {
    if (this.normals) return this.normals
    const normals: VertexNormal[] = new Array(this.usedVertexCount)
    for (let i = 0; i < this.usedVertexCount; i++) {
      normals[i] = { x: 0, y: 0, z: 0, magnitude: 0 }
    }
    for (let i = 0; i < this.faceCount; i++) {
      const a = this.indices1[i]!
      const b = this.indices2[i]!
      const c = this.indices3[i]!
      const abx = this.verticesX[b]! - this.verticesX[a]!
      const aby = this.verticesY[b]! - this.verticesY[a]!
      const abz = this.verticesZ[b]! - this.verticesZ[a]!
      const acx = this.verticesX[c]! - this.verticesX[a]!
      const acy = this.verticesY[c]! - this.verticesY[a]!
      const acz = this.verticesZ[c]! - this.verticesZ[a]!
      let nx = aby * acz - acy * abz
      let ny = abz * acx - acz * abx
      let nz = abx * acy - acx * aby
      while (nx > 8192 || ny > 8192 || nz > 8192 || nx < -8192 || ny < -8192 || nz < -8192) {
        nx >>= 1
        ny >>= 1
        nz >>= 1
      }
      let len = Math.sqrt(nx * nx + ny * ny + nz * nz) | 0
      if (len <= 0) len = 1
      nx = ((nx * 256) / len) | 0
      ny = ((ny * 256) / len) | 0
      nz = ((nz * 256) / len) | 0

      const type = this.faceRenderTypes ? this.faceRenderTypes[i]! : 0
      if (type === 0) {
        for (const v of [a, b, c]) {
          const n = normals[v]!
          n.x += nx
          n.y += ny
          n.z += nz
          n.magnitude++
        }
      } else if (type === 1) {
        if (!this.faceNormals) this.faceNormals = new Array(this.faceCount)
        this.faceNormals[i] = { x: nx, y: ny, z: nz }
      }
    }
    this.normals = normals
    return normals
  }

  /**
   * The client's `Model light(ambient, contrast, x, y, z)`: bakes directional
   * lighting into per-vertex HSL16 colours. NPCs use (64 + ambient, 850 + contrast, -30, -50, -30).
   */
  light(ambient: number, contrast: number, lightX: number, lightY: number, lightZ: number): Model {
    const normals = this.calculateVertexNormals()
    const magnitude = Math.sqrt(lightZ * lightZ + lightX * lightX + lightY * lightY) | 0
    const intensity = (magnitude * contrast) >> 8

    const model = new Model()
    model.faceColors1 = new Int32Array(this.faceCount)
    model.faceColors2 = new Int32Array(this.faceCount)
    model.faceColors3 = new Int32Array(this.faceCount)

    const lightVertex = (v: number): number => {
      const n = normals[v]!
      return ((lightY * n.y + lightZ * n.z + lightX * n.x) / (intensity * n.magnitude) + ambient) | 0
    }

    for (let i = 0; i < this.faceCount; i++) {
      let type = this.faceRenderTypes ? this.faceRenderTypes[i]! : 0
      const alpha = this.faceAlphas ? this.faceAlphas[i]! : 0
      const texture = this.faceTextures ? this.faceTextures[i]! : -1
      if (alpha === -2) type = 3
      if (alpha === -1) type = 2

      if (texture === -1) {
        if (type === 0) {
          const color = this.faceColors[i]! & 0xffff
          model.faceColors1[i] = adjustLightness(color, lightVertex(this.indices1[i]!))
          model.faceColors2[i] = adjustLightness(color, lightVertex(this.indices2[i]!))
          model.faceColors3[i] = adjustLightness(color, lightVertex(this.indices3[i]!))
        } else if (type === 1) {
          const n = this.faceNormals?.[i] ?? { x: 0, y: 0, z: 0 }
          const l =
            ((lightY * n.y + lightZ * n.z + lightX * n.x) / ((intensity >> 1) + intensity) + ambient) | 0
          model.faceColors1[i] = adjustLightness(this.faceColors[i]! & 0xffff, l)
          model.faceColors3[i] = -1
        } else if (type === 3) {
          model.faceColors1[i] = 128
          model.faceColors3[i] = -1
        } else {
          model.faceColors3[i] = -2
        }
      } else if (type === 0) {
        model.faceColors1[i] = clampLightness(lightVertex(this.indices1[i]!))
        model.faceColors2[i] = clampLightness(lightVertex(this.indices2[i]!))
        model.faceColors3[i] = clampLightness(lightVertex(this.indices3[i]!))
      } else if (type === 1) {
        const n = this.faceNormals?.[i] ?? { x: 0, y: 0, z: 0 }
        const l =
          ((lightY * n.y + lightZ * n.z + lightX * n.x) / ((intensity >> 1) + intensity) + ambient) | 0
        model.faceColors1[i] = clampLightness(l)
        model.faceColors3[i] = -1
      } else {
        model.faceColors3[i] = -2
      }
    }

    model.vertexCount = this.vertexCount
    model.usedVertexCount = this.usedVertexCount
    model.verticesX = this.verticesX
    model.verticesY = this.verticesY
    model.verticesZ = this.verticesZ
    model.faceCount = this.faceCount
    model.indices1 = this.indices1
    model.indices2 = this.indices2
    model.indices3 = this.indices3
    model.faceColors = this.faceColors
    model.faceRenderPriorities = this.faceRenderPriorities
    model.priority = this.priority
    model.faceAlphas = this.faceAlphas
    model.faceTextures = this.faceTextures
    model.textureCoords = this.textureCoords
    model.textureFaceCount = this.textureFaceCount
    model.textureRenderTypes = this.textureRenderTypes
    model.textureMappingP = this.textureMappingP
    model.textureMappingM = this.textureMappingM
    model.textureMappingN = this.textureMappingN
    model.uvs = model.computeTextureCoords()
    model.source = this
    return model
  }
}

function groupByLabel(skins: Int32Array, count: number): Int32Array[] {
  const counts = new Int32Array(256)
  let highest = -1
  for (let i = 0; i < count; i++) {
    const skin = skins[i]!
    if (skin >= 0 && skin < 256) {
      counts[skin] = counts[skin]! + 1
      if (skin > highest) highest = skin
    }
  }
  const labels: Int32Array[] = new Array(highest + 1)
  for (let i = 0; i <= highest; i++) {
    labels[i] = new Int32Array(counts[i]!)
    counts[i] = 0
  }
  for (let i = 0; i < count; i++) {
    const skin = skins[i]!
    if (skin >= 0 && skin < 256) {
      labels[skin]![counts[skin]!] = i
      counts[skin] = counts[skin]! + 1
    }
  }
  return labels
}
