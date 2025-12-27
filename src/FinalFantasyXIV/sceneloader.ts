import { FFXIVFilesystem, pathBase } from "./files/Filesystem";
import { SceneNode } from "./scenegraph";
import { SgbFile } from "./files/layer";
import { FFXIVLgb, FFXIVModel, LayerWrapped } from "../../rust/pkg";
import { DataFetcher } from "../DataFetcher";
import { Terrain } from "./files/Terrain";
import { range } from "../MathHelpers";
import { mat4, vec2, vec3 } from "gl-matrix";
import { FlatLayoutObject } from "./files/FlatLayoutObject";

export class SceneLoader {
    public dataFetcher: DataFetcher;

    constructor(public filesystem: FFXIVFilesystem) {
        this.dataFetcher = filesystem.dataFetcher;
    }

    public async loadLevel(levelId: string): Promise<SceneNode> {

        const lgbNames = [
            "bg.lgb",
            "planmap.lgb",
            // "planevent.lgb",
            // "planner.lgb",
            // "planlive.lgb",
            // "vfx.lgb",
        ];

        const children = Promise.all([
            this.loadTerrain(levelId),
            ...await Promise.all(lgbNames.map(async name => {
                const lgb = await this.filesystem.loadLgb(`${levelId}/level/${name}`);
                return await this.createNodeFromGb(name, lgb);
            })),
        ])

        return {
            name: `Level ${levelId}`,
            children: await children,
            model_matrix: new Float32Array(mat4.create()),
        }
    }

    public async loadTerrain(levelId: string): Promise<SceneNode> {
        const path = `${levelId}/bgplate/terrain.tera`;
        const terrain = new Terrain(await this.dataFetcher.fetchData(`${pathBase}/${path}`));

        const partNames = terrain.modelNames = range(0, terrain.plateCount).map(i => {
            const fn = `${i}`.padStart(4, "0");
            return `${levelId}/bgplate/${fn}.mdl`;
        });

        const models = await Promise.all(partNames.map(p => this.filesystem.loadPart(p))) as FFXIVModel[]; // yuck
        terrain.models = models;
        await Promise.all(models.map(x => this.loadDependenciesOfModel(x!)));

        return this.createTerrainSceneNode(terrain);
    }

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
                model_name: terrain.modelNames[i],
                data: terrain.models[i], model_matrix: new Float32Array(model_matrix),
            };
        }
        const terrainModel = mat4.create();
        return {
            name: `Terrain`,
            children: terrainPlateNodes, data: terrain, model_matrix: new Float32Array(terrainModel),
        }
    }

    public async createNodeFromGb(path: string, gb: FFXIVLgb | SgbFile, filter_festival_id: number = 0): Promise<SceneNode> {
        const rootModel = mat4.create();
        const layers = gb.layers;
        const children = await Promise.all(layers.filter(o => o.festival_id == filter_festival_id).map(o => this.createLayerNode(o)));

        return {
            name: `GB ${path}`,
            children: children, data: gb,
            model_matrix: new Float32Array(rootModel),
            animationController: (gb as SgbFile).animation_controller,
        }
    }

    async createLayerNode(layer: LayerWrapped): Promise<SceneNode> {
        const children = await Promise.all(layer.objects.map(o => this.createObjectNode(o)));

        return {
            name: `Layer ${layer.name}`,
            children: children, data: layer,
            model_matrix: new Float32Array(mat4.create()),
        }
    }

    async createObjectNode(obj: FlatLayoutObject): Promise<SceneNode> {
        const test = new Float32Array(mat4.create());
        obj.write_model_matrix(test);

        let baseNode: SceneNode = {
            name: obj.asset_name,
            data: obj,
            model_matrix: test, // TODO animate
        }

        if (obj.object_type == 0x01) {
            const model = await this.filesystem.loadPart(obj.asset_name!);
            if (model) await this.loadDependenciesOfModel(model);
            baseNode.model_name = obj.asset_name;
            // baseNode.renderer = this.modelCache[obj.asset_name!];
        } else if (obj.object_type == 0x06) {
            const assetName = obj.asset_name!;
            const sgb = await this.filesystem.loadSgb(assetName);
            if (sgb) {
                baseNode.children = [await this.createNodeFromGb(assetName, sgb)];
            }
        } else if (obj.object_type == 0x2f) {
            await this.filesystem.loadTexture(obj.asset_name!);
        }
        return baseNode;
    }

    async loadDependenciesOfModel(model: FFXIVModel) {
        const materialsInTera = model.meshes.map(mesh => model.materials[mesh.get_material_index()]);
        const materials = await loadUniques(p => this.filesystem.loadMaterial(p), materialsInTera);
        const textures = await loadUniques((p) => this.filesystem.loadTexture(p), materials.flatMap(m => m.texture_names));
    }
}

async function loadUniques<T>(loader: (path: string) => Promise<T>, paths: string[]): Promise<T[]> {
    const set = new Set(paths);
    const uniq = [...set.values()];
    return await Promise.all(uniq.map(mat => loader(mat)));
}