import { mat4, quat, ReadonlyMat4, vec2, vec3, vec4 } from "gl-matrix";
import { FFXIVLgb, FFXIVModel, FFXIVSgb } from "../../rust/pkg";
import { Terrain } from "./Terrain";
import { ModelRenderer, RenderGlobals } from "./render";
import { FFXIVFilesystem } from "./Filesystem";
import { FlatLayoutObject } from "./FlatLayoutObject";
import { SgbFile } from "./sgb";
import { rust } from "../rustlib";

export type SceneNodeData = FFXIVLgb | SgbFile | FFXIVModel | Terrain | FlatLayoutObject;

export interface SceneNode {
    name: string | null;
    data: SceneNodeData | null;
    renderer: ModelRenderer | null;
    animationController: rust.AnimationController | null;

    model_matrix: Float32Array;

    children: SceneNode[] | null;
}

export interface SceneGraph extends SceneNode {
}

export class SceneGraphCreator {
    constructor(private modelCache: { [key: string]: ModelRenderer }, private fs: FFXIVFilesystem) {
    }

    createRootNode(): SceneGraph {
        return {
            name: "Root Node",
            renderer: null,
            data: null, model_matrix: new Float32Array(mat4.create()),
            children: [],
            animationController: null,
        }
    }

    // createSceneGraph(): SceneGraph {
    //     const children: SceneNode[] = [];
    //
    //     if (this.fs.terrain) {
    //         children.push(this.createTerrainSceneNode(this.fs.terrain!));
    //     }
    //
    //     for (let [name, lgb] of this.fs.lgbs) {
    //         children.push(this.createLgbSceneNode(name, lgb));
    //     }
    //
    //
    // }

    createTerrainSceneNode(terrain: Terrain): SceneNode {
        const vec2scratch = vec2.create();
        const vec3scratch = vec3.create();

        const terrainPlateNodes: SceneNode[] = new Array(terrain.plateCount);
        for (let i = 0; i < terrain.plateCount; i++) {
            const model_matrix = mat4.create();
            const xz = vec2scratch;

            terrain.getPlatePosition(xz, i);
            xz[0] += 0.5;
            xz[1] += 0.5;
            vec2.scale(xz, xz, terrain.plateSize);

            const translation = vec3scratch;
            vec3.set(translation, xz[0], 0, xz[1]);
            mat4.fromTranslation(model_matrix, translation);

            terrainPlateNodes[i] = {
                name: `Terrain plate ${i}`,
                renderer: this.modelCache[terrain.modelNames[i]],
                children: null, data: terrain.models[i], model_matrix: new Float32Array(model_matrix),
                animationController: null,
            };
        }
        const terrainModel = mat4.create();
        return {
            name: `Terrain`,
            renderer: null,
            children: terrainPlateNodes, data: terrain, model_matrix: new Float32Array(terrainModel),
            animationController: null,
        }
    }


    createLgbSceneNode(name: string, lgb: FFXIVLgb): SceneNode {
        const rootModel = mat4.create();
        const objects = lgb.objects;
        const children: SceneNode[] = new Array(objects.length);
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            children[i] = this.createObjectSceneNode(obj);
        }

        return {
            name: `LGB ${name}`,
            children: children, data: lgb, renderer: null, model_matrix: new Float32Array(rootModel),
            animationController: null,
        }
    }

    createSgbSceneNode(name: string, sgb: SgbFile): SceneNode {
        const rootModel = mat4.create();
        const objects = sgb.objects;
        const children: SceneNode[] = new Array(objects.length);
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            children[i] = this.createObjectSceneNode(obj);
        }

        return {
            name: `SGB ${name}`,
            children: children, data: sgb, renderer: null, model_matrix: new Float32Array(rootModel),
            animationController: sgb.inner.animation_controller,
        }
    }

    createObjectSceneNode(obj: FlatLayoutObject): SceneNode {
        const test = new Float32Array(mat4.create());
        obj.write_model_matrix(test);

        let baseNode: SceneNode = {
            name: obj.asset_name ?? null,
            renderer: null,
            children: null,
            data: obj,
            model_matrix: test, // TODO animate
            animationController: null,
        }

        if (obj.layer_type == 0x01) {
            baseNode.renderer = this.modelCache[obj.asset_name!];
        } else if (obj.layer_type == 0x06) {
            const assetName = obj.asset_name!;
            const sgb = this.fs.sgbs.get(assetName);
            if (sgb) {
                baseNode.children = [this.createSgbSceneNode(assetName, sgb)];
            }
        }
        return baseNode;
    }
}

const scratchVec4 = vec4.create();


export function* walkScene(node: SceneNode): Generator<SceneNode> {
    yield node;
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
        for (let x of walkScene(node.children![i])) yield x;
    }
}
