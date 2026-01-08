import * as Viewer from "../../viewer";
import { RenderGlobals } from "./globals";
import * as UI from "../../ui";
import { Animator } from "../animate";
import { DebugSceneGraphPanel } from "../debug";
import { GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice } from "../../gfx/platform/GfxPlatform";
import { FFXIVFilesystem } from "../files/Filesystem";
import { SceneGraph, SceneNode, walkScene } from "../scene";
import { colorNewFromRGBA } from "../../Color";
import { CameraController } from "../../Camera";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { getDebugOverlayCanvas2D } from "../../DebugJunk";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph";
import { FestivalPanel } from "../festivals";
import { MeshProgram, randomColorMap } from "./mesh";
import { ModelRenderer } from "./model";
import { FakeTextureHolder } from "../../TextureHolder";

export class FFXivSceneRenderer implements Viewer.SceneGfx {
    globals: RenderGlobals;
    public textureHolder: UI.TextureListHolder;
    public animator = new Animator();

    private debugPanel = new DebugSceneGraphPanel();

    constructor(device: GfxDevice, filesystem: FFXIVFilesystem, public sceneGraph: SceneGraph) {
        const globals = this.globals = new RenderGlobals(device, filesystem);

        console.time("Process textures");
        const vTextures = processTextures(device, filesystem);
        console.timeEnd("Process textures");
        this.textureHolder = vTextures;

        for (const [materialPath, material] of filesystem.materials.entries()) {
            const textureName = material?.texture_names[0];
            const texture = globals.filesystem.textures.get(textureName);
            const alpha = (texture == undefined || texture.gfxTexture == null) ? 0.9 : 0.0

            randomColorMap[materialPath] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), alpha);
        }

        this.cacheModelRenderers(sceneGraph);
    }

    public cacheModelRenderers(scene: SceneNode) {
        console.time("Create model renderers")
        const modelEntries = this.globals.filesystem.models.entries();
        for (const [path, model] of modelEntries) {
            this.globals.modelCache[path] = new ModelRenderer(this.globals, model);
        }
        console.timeEnd("Create model renderers")

        for (let node of walkScene(scene)) {
            const model_name = node.model_name as string | undefined;
            if (model_name) {
                node.renderer = this.globals.modelCache[model_name];
            }
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 60);
    }

    private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1)
        const renderHelper = this.globals.renderHelper;

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(this.globals.meshProgram.bindingLayouts);
        template.setGfxProgram(this.globals.meshGfxProgram);
        template.setMegaStateFlags({cullMode: GfxCullMode.Back});

        setAttachmentStateSimple(template.getMegaStateFlags(), {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        let offs = template.allocateUniformBuffer(MeshProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(MeshProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);

        renderHelper.renderInstManager.setCurrentList(this.globals.renderInstListMain);

        this.animator.animate(this.sceneGraph, viewerInput.time);

        this.prepareToRenderScene(viewerInput);

        renderHelper.renderInstManager.popTemplate();
        renderHelper.prepareToRender();
    }

    public prepareToRenderScene(viewerInput: Viewer.ViewerRenderInput) {
        this.prepareToRenderNode(mat4.create(), this.sceneGraph, viewerInput);
    }

    scratchVec3 = vec3.create();
    debugCanvas = getDebugOverlayCanvas2D();

    public prepareToRenderNode(parent_transform: mat4, node: SceneNode, viewerInput: Viewer.ViewerRenderInput) {
        const invert = mat4.create();
        mat4.invert(invert, node.model_matrix);

        mat4.mul(parent_transform, parent_transform, node.model_matrix);
        node?.renderer?.prepareToRender(this.globals.renderInstManager, viewerInput, parent_transform);

        mat4.getTranslation(this.scratchVec3, parent_transform);
        const node_instance_id = (node.data as any)?.instance_id;
        const layer_type = (node?.data as any)?.layer_type;
        // if (layer_type == 1 || layer_type == 6) {
        //     const name = node.name ? node.name.substring(node.name.lastIndexOf("/") + 1) : `type ${(node?.data as any)?.layer_type}`
        //     drawWorldSpaceText(this.debugCanvas, viewerInput.camera.clipFromWorldMatrix, this.scratchVec3, `${node_instance_id} ${name}`, -10, OpaqueBlack, {
        //         font: "6pt monospace",
        //         align: "center"
        //     })
        //     drawWorldSpacePoint(this.debugCanvas, viewerInput.camera.clipFromWorldMatrix, this.scratchVec3, OpaqueBlack, 3);
        // }

        if (node == this.debugPanel.highlightedNode) {
            if (node.renderer instanceof ModelRenderer) {
                (node.renderer as ModelRenderer).debugDraw(viewerInput, parent_transform);
            }
        }


        for (let i = 0; i < (node.children?.length ?? 0); i++) {
            this.prepareToRenderNode(parent_transform, node.children![i], viewerInput);
        }
        mat4.mul(parent_transform, parent_transform, invert);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderHelper = this.globals.renderHelper;
        const renderInstListMain = this.globals.renderInstListMain;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstListMain.drawOnPassRenderer(renderHelper.renderCache, passRenderer);
            });
        });
        renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(viewerInput);
        renderHelper.renderGraph.execute(builder);
        renderInstListMain.reset();
    }

    public destroy(): void {
        // this.modelRenderers.forEach((r) => r?.destroy());
        this.globals.destroy();
    }

    createPanels(): UI.Panel[] {
        return [new FestivalPanel(), this.debugPanel.createPanel(this.sceneGraph)];
    }

}

export function processTextures(device: GfxDevice, filesystem: FFXIVFilesystem): FakeTextureHolder {
    const vTextures: Viewer.Texture[] = [];
    const fth = new FakeTextureHolder(vTextures);
    for (let [path, texture] of filesystem.textures.entries()) {
        const gfxTexture = texture.createGfxTexture(device);
        if (!gfxTexture) {
            console.log(`Failed to make texture for ${texture.format}`)
        }
        if (texture.canvas) {
            vTextures.push({name: path, surfaces: [texture.canvas]});
            fth.textureNames.push(texture.path);
        }
    }
    return fth;
}