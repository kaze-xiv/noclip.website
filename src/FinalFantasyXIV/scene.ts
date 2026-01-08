import { mat4, quat, ReadonlyMat4, vec2, vec3, vec4 } from "gl-matrix";
import { FFXIVLgb, FFXIVModel, FFXIVSgb } from "../../rust/pkg";
import { Terrain } from "./Terrain";
import { ModelRenderer, RenderGlobals } from "./render";
import { FFXIVFilesystem } from "./Filesystem";
import { FlatLayoutObject } from "./FlatLayoutObject";
import { SgbFile } from "./sgb";

type SceneNodeData = FFXIVLgb | SgbFile | FFXIVModel | Terrain | FlatLayoutObject;

export interface SceneNode {
    name: string | null;
    data: SceneNodeData | null;
    renderer: ModelRenderer | null;

    model_matrix: mat4;

    children: SceneNode[] | null;
}

export interface SceneGraph extends SceneNode {
}

class SceneGraphCreator {
    constructor(private modelCache: { [key: string]: ModelRenderer }, private fs: FFXIVFilesystem) {
    }

    createSceneGraph(): SceneGraph {
        return {
            name: "Root Node",
            renderer: null,
            data: null, model_matrix: mat4.create(),
            children: [
                this.createTerrainSceneNode(),
                ...[...this.fs.lgbs.entries()].map(([name, lgb]) => this.createLgbSceneNode(name, lgb)),
            ]
        }
    }

    createTerrainSceneNode(): SceneNode {
        const vec2scratch = vec2.create();
        const vec3scratch = vec3.create();

        const terrain = this.fs.terrain;
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
                renderer: this.modelCache[this.fs.terrain.modelNames[i]],
                children: null, data: this.fs.terrain.models[i], model_matrix: model_matrix
            };
        }
        const terrainModel = mat4.create();
        return {
            name: `Terrain`,
            renderer: null,
            children: terrainPlateNodes, data: terrain, model_matrix: terrainModel,
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
            children: children, data: lgb, renderer: null, model_matrix: rootModel,
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
            children: children, data: sgb, renderer: null, model_matrix: rootModel,
        }
    }

    createObjectSceneNode(obj: FlatLayoutObject): SceneNode {
        const test = mat4.create();
        const rot = scratchVec4;
        const origRot = obj.rotation;
        quat.fromEuler(rot, origRot[0] / Math.PI * 180, origRot[1] / Math.PI * 180, origRot[2] / Math.PI * 180);
        mat4.fromRotationTranslationScale(test, rot, obj.translation, obj.scale);

        let baseNode: SceneNode = {
            name: obj.asset_name ?? null,
            renderer: null,
            children: null,
            data: obj,
            model_matrix: test, // TODO animate
        }

        if (obj.layer_type == 0x01) {
            baseNode.renderer = this.modelCache[obj.asset_name!];
        } else if (obj.layer_type == 0x06) {
            const sgb = this.fs.sgbs.get(obj.asset_name!);
            if (sgb) {
                baseNode.children = [this.createSgbSceneNode(obj.asset_name!, sgb)];
            }
        }
        return baseNode;
    }
}

export function createSceneGraph(globals: RenderGlobals): SceneGraph {
    return new SceneGraphCreator(globals.modelCache, globals.filesystem).createSceneGraph();
}

const scratchVec4 = vec4.create();
