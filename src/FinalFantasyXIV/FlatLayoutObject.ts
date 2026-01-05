import { rust } from "../rustlib";

export interface FlatLayoutObject extends rust.FlatLayoutObject {

}

export function shimFlatLayoutObject(file: rust.FlatLayoutObject): FlatLayoutObject {
    return {
        festival_id: file.festival_id, festival_phase_id: file.festival_phase_id,
        asset_name: file.asset_name,
        layer_type: file.layer_type,
        rotation: file.rotation,
        scale: file.scale,
        translation: file.translation,
        free: null as any

    };
    // return structuredClone(file);
}