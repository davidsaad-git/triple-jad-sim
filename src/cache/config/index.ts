/**
 * OSRS config decoders (index 2). Each type exposes a static `decode(id, data)`
 * and a cached `*Loader` backed by the matching config archive.
 */
export * from './Type'
export * from './NpcType'
export * from './SeqType'
export * from './LocModelType'
export * from './LocType'
export * from './ObjType'
export * from './IdkType'
export * from './SpotAnimType'
export * from './UnderlayFloorType'
export * from './OverlayFloorType'
export * from './VarBitType'
export * from './ParamType'
export * from './StructType'
export * from './EnumType'
export * from './HitsplatType'
export * from './HealthBarType'
