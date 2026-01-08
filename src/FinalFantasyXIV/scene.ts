import { FFXIVLgb, FFXIVModel } from "../../rust/pkg";
import { Terrain } from "./files/Terrain";
import { FlatLayoutObject } from "./files/FlatLayoutObject";
import { SgbFile } from "./files/sgb";
import { rust } from "../rustlib";
import { ModelRenderer } from "./render/model";

export type SceneNodeData = FFXIVLgb | SgbFile | FFXIVModel | Terrain | FlatLayoutObject;

export interface SceneNode {
    name?: string;
    data?: SceneNodeData;
    model_name?: string;
    renderer?: ModelRenderer;
    animationController?: rust.AnimationController;
    model_matrix: Float32Array;
    children?: SceneNode[];
}

export interface SceneGraph extends SceneNode {
}

export function* walkScene(node: SceneNode): Generator<SceneNode> {
    yield node;
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
        for (let x of walkScene(node.children![i])) yield x;
    }
}
