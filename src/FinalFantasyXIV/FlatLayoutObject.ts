import { rust } from "../rustlib";

export interface FlatLayoutObject extends rust.FlatLayoutObject {

}

export function shimFlatLayoutObject(file: rust.FlatLayoutObject): FlatLayoutObject {
    return {
        write_model_matrix(target: Float32Array): void {
            file.write_model_matrix(target);
        },
        festival_id: file.festival_id, festival_phase_id: file.festival_phase_id,
        asset_name: file.asset_name,
        layer_type: file.layer_type,
        free: null as any,
        instance_id: file.instance_id
    };
    // return structuredClone(file);
}