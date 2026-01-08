import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import * as Viewer from '../../viewer.js';
import { MeshRenderer } from "./mesh";
import { FFXIVModel, MeshWrapper } from "../../../rust/pkg";
import { RenderGlobals } from "./globals";
import { ReadonlyMat4 } from "gl-matrix";


export class ModelRenderer {
    public meshRenderers: MeshRenderer[] = [];
    public meshes: MeshWrapper[] = [];

    constructor(public globals: RenderGlobals, model: FFXIVModel) {
        this.meshes = model.meshes;
        const materials = model.materials;

        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            this.meshRenderers.push(new MeshRenderer(globals, materials[mesh.get_material_index()], mesh))
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4): void {
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(viewerInput, modelMatrix);
    }

    public debugDraw(viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4) {
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].debugDrawVertices(viewerInput, modelMatrix);
    }

    destroy() {
        this.meshRenderers.forEach((r) => r.destroy());
    }
}