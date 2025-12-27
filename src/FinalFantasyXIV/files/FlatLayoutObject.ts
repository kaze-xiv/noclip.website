import { rust } from "../../rustlib";

export interface FlatLayoutObject extends rust.LayerObject {

}

export function shimFlatLayoutObject(file: rust.LayerObject): FlatLayoutObject {
    return {
        write_model_matrix(target: Float32Array): void {
            file.write_model_matrix(target);
        },
        asset_name: file.asset_name,
        object_type: file.object_type,
        free: null as any,
        instance_id: file.instance_id
    };
    // return structuredClone(file);
}