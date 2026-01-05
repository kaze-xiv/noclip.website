import { mat4, quat, ReadonlyMat4, vec2, vec3, vec4 } from 'gl-matrix';

import { DeviceProgram } from '../Program.js';
import * as Viewer from '../viewer.js';

import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { CameraController, computeViewMatrix } from '../Camera.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { FFXIVLgb, FFXIVModel, FlatLayoutObject, MeshWrapper } from "../../rust/pkg";
import { Color, colorFromHSL, colorNewCopy, colorNewFromRGBA, OpaqueBlack } from "../Color";
import { getTriangleCountForTopologyIndexCount, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { Terrain } from "./Terrain";
import { FFXIVFilesystem } from "./Filesystem";
import { FakeTextureHolder, TextureMapping } from "../TextureHolder";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TextureListHolder } from "../ui";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ObjectParams {
    Mat3x4 u_ModelView;
    vec4 u_Color;
};

varying float v_LightIntensity;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;

uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;
uniform sampler2D u_Texture3;
uniform sampler2D u_Texture4;
uniform sampler2D u_Texture5;
uniform sampler2D u_Texture6;


#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${IVProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${IVProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;


void mainVS() {
    const float t_ModelScale = 1.0;
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position * t_ModelScale, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_LightIntensity = -dot(a_Normal, t_LightDirection);
    v_TexCoord0 = a_TexCoord0;
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_DiffuseMapColor = texture(SAMPLER_2D(u_Texture1), v_TexCoord0.xy);
    vec3 t_NormalMap = texture(SAMPLER_2D(u_Texture2), v_TexCoord0.xy).xyz;
    vec3 t_LightDirection2 = normalize(vec3(.2, -1, .5));
    //t_NormalMap.z = 0.5;
    float eDotR = -dot(t_NormalMap, t_LightDirection2);

    vec3 albedo = u_Color.a > 0.5 ? u_Color.xyz : t_DiffuseMapColor.rgb;
    gl_FragColor = vec4(albedo * (eDotR + 0.5), t_DiffuseMapColor.a);
}
#endif
`;
}

const stride = 23 * 4;

export class MeshRenderer {
    public name: string;
    public color: Color;

    public vertexBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    public drawCount: number;
    public triBuffer: GfxBuffer;
    public textureMappings: (TextureMapping | null)[] = [];

    constructor(public globals: RenderGlobals,
                public materialName: string,
                public mesh: MeshWrapper) {
        const material = globals.filesystem.materials.get(materialName);
        const textures = material?.texture_names.map(x => globals.filesystem.textures.get(x));
        this.textureMappings = textures?.map(t => {
            if (!t?.gfxTexture) return null;
            const mapping = new TextureMapping();
            mapping.gfxTexture = t.gfxTexture;
            mapping.gfxSampler = globals.repeatSampler;
            return mapping;
        }) ?? [];

        this.color = randomColorMap[materialName];

        const vertices = mesh.attributes();
        this.vertexBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer)

        const triBytes = mesh.indices();
        this.drawCount = getTriangleCountForTopologyIndexCount(GfxTopology.Triangles, triBytes.length);
        this.triBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, triBytes.buffer);
        this.indexBufferDescriptor = {buffer: this.triBuffer};

        this.vertexBufferDescriptors = [
            {buffer: this.vertexBuffer},
        ];
    }

    public debugDrawVertices(viewerInput: Viewer.ViewerRenderInput) {
        // const view = new DataView(this.vertices.buffer);
        // const vec = vec3.create();
        // for (let i = 0; i < this.vertices.length / stride; i++) {
        //     const start = stride * i;
        //     vec3.set(vec, view.getFloat32(start + 0), view.getFloat32(start + 4), view.getFloat32(start + 8));
        //     vec3.add(vec, vec, this.terrainModelRenderer.origin);
        //     drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, this.color, 3);
        //     // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, `${i}`, 0, OpaqueBlack, {font: "12pt monospace"})
        // }
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4): void {
        const renderInstManager = this.globals.renderInstManager;
        const templateRenderInst = renderInstManager.getCurrentTemplate();

        computeViewMatrix(mat4scratch, viewerInput.camera);
        mat4.mul(mat4scratch, mat4scratch, modelMatrix);

        let offs = templateRenderInst.allocateUniformBuffer(IVProgram.ub_ObjectParams, 4 + 16);
        const d = templateRenderInst.mapUniformBufferF32(IVProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, mat4scratch);
        offs += fillColor(d, offs, this.color);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.globals.layout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.drawCount * 3);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInstManager.submitRenderInst(renderInst);

    }

    public destroy(): void {
        const device = this.globals.renderHelper.device;
        device.destroyBuffer(this.vertexBuffer);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    {numUniformBuffers: 3, numSamplers: 6}, // ub_SceneParams
];

const randomColorMap: { [name: string]: Color } = {};
(window as any).randomColorMap = randomColorMap;

const mat4scratch = mat4.create();

export class ModelRenderer {
    public meshRenderers: MeshRenderer[] = [];
    public meshes: MeshWrapper[] = [];

    constructor(public globals: RenderGlobals, public model: FFXIVModel) {
        this.meshes = model.meshes;
        const materials = model.materials;

        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            this.meshRenderers.push(new MeshRenderer(globals, materials[mesh.get_material_index()], mesh))
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4): void {
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(viewerInput, modelMatrix);
    }

    destroy() {
        this.meshRenderers.forEach((r) => r.destroy());
    }
}

type LayoutObjectRenderer = ModelRenderer | LayoutObjectsRenderer | null;

export class LayoutObjectsRenderer {
    public objectRenderers: (LayoutObjectRenderer | null)[];
    private debugColor: Color = colorNewCopy(OpaqueBlack);

    constructor(public globals: RenderGlobals, public objects: FlatLayoutObject[], public modelMatrix: ReadonlyMat4 = mat4.create()) {
        const objs = this.objects;
        this.objectRenderers = new Array(objs.length);

        for (let i = 0; i < objs.length; i++) {
            const obj = objs[i];
            this.objectRenderers[i] = this.findRendererForObject(obj);
        }

        colorFromHSL(this.debugColor, Math.random(), 0.7, 0.6);
    }

    findRendererForObject(obj: FlatLayoutObject): LayoutObjectRenderer {
        if (obj.layer_type == 0x01) {
            const mdlLookup = this.globals.modelCache[obj.asset_name!];
            return mdlLookup;
        } else if (obj.layer_type == 0x06) {
            const sgb = this.globals.filesystem.sgbs.get(obj.asset_name!);
            if (!sgb) return null;
            const joint = mat4.create();
            const mine = mat4.create();
            this.calculateModelMatrix(mine, obj);
            mat4.mul(joint, this.modelMatrix, mine);
            return new LayoutObjectsRenderer(this.globals, sgb?.objects, joint);
        }
        return null;
    }

    private scratchMat = mat4.create();
    private scratchMat2 = mat4.create();
    private scratchVec4 = vec4.create();

    private scratchVec3 = vec3.create();

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        const modelMatrix = this.scratchMat;
        const jointModelMatrix = this.scratchMat2;

        for (let i = 0; i < this.objectRenderers.length; i++) {
            const obj = this.objects[i];

            this.calculateModelMatrix(jointModelMatrix, obj);
            mat4.mul(modelMatrix, jointModelMatrix, this.modelMatrix)

            const renderer = this.objectRenderers[i];
            if (renderer) {
                renderer.prepareToRender(renderInstManager, viewerInput, modelMatrix);
            }

            // debug
            // mat4.getTranslation(this.scratchVec3, modelMatrix);
            // if (obj.layer_type != 1) {
            //     drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.scratchVec3, `${obj.asset_name} ${obj.layer_type}`, 10, this.debugColor, {
            //         font: "6pt monospace",
            //         align: "center"
            //     })
            // }
            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.scratchVec3, this.debugColor, 3);

        }
    }

    calculateModelMatrix(dst: mat4, obj: FlatLayoutObject) {
        const rot = this.scratchVec4;

        const origRot = obj.rotation;
        quat.fromEuler(rot, origRot[0] / Math.PI * 180, origRot[1] / Math.PI * 180, origRot[2] / Math.PI * 180);
        mat4.fromRotationTranslationScale(dst, rot, obj.translation, obj.scale);
    }

    destroy() {
        this.objectRenderers.forEach((r) => r?.destroy());
    }
}

export class TerrainRenderer {
    public modelRenderers: ModelRenderer[];

    private mat4Scratcha = mat4.create();
    private vec2scratch = vec2.create();
    private vec3scratch = vec3.create();

    constructor(public globals: RenderGlobals, public terrain: Terrain) {
        this.modelRenderers = new Array(terrain.models.length);
        for (let i = 0; i < terrain.models.length; ++i) {
            this.modelRenderers[i] = new ModelRenderer(globals, terrain.models[i]);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.modelRenderers.length; i++) {
            const renderer = this.modelRenderers[i]
            const modelMatrix = this.mat4Scratcha;
            this.computeModelMatrix(modelMatrix, i)

            renderer.prepareToRender(renderInstManager, viewerInput, modelMatrix);
        }
    }

    public computeModelMatrix(out: mat4, index: number) {
        const terrain = this.globals.filesystem.terrain;
        const xz = this.vec2scratch;

        terrain.getPlatePosition(xz, index);
        xz[0] += 0.5;
        xz[1] += 0.5;
        vec2.scale(xz, xz, terrain.plateSize);

        const translation = this.vec3scratch;
        vec3.set(translation, xz[0], 0, xz[1]);
        mat4.fromTranslation(out, translation);
    }
}

export class RenderGlobals {
    public meshProgram = new IVProgram();
    public meshGfxProgram: GfxProgram;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public layout: GfxInputLayout;
    public repeatSampler: GfxSampler;

    public modelCache: { [key: string]: ModelRenderer } = {};

    constructor(device: GfxDevice, public filesystem: FFXIVFilesystem) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderInstManager = this.renderHelper.renderInstManager;
        this.meshGfxProgram = this.renderHelper.renderCache.createProgram(this.meshProgram);
        this.layout = this.createLayout();
        this.repeatSampler = this.renderHelper.renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });
    }

    public createLayout(): GfxInputLayout {
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        vertexAttributeDescriptors.push({
            location: IVProgram.a_Position,
            bufferIndex: 0,
            bufferByteOffset: 0,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_TexCoord0,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_TexCoord1,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 1 * vec2fSize,
            format: GfxFormat.F32_RGB
        });
        vertexAttributeDescriptors.push({
            location: IVProgram.a_Normal,
            bufferIndex: 0,
            bufferByteOffset: 1 * vec3fSize + 2 * vec2fSize,
            format: GfxFormat.F32_RGB
        });

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            {byteStride: stride, frequency: GfxVertexBufferFrequency.PerVertex,},
        ];
        const indexBufferFormat: GfxFormat | null = GfxFormat.U16_R;
        const cache = this.renderHelper.renderCache;
        const inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat
        });
        return inputLayout;
    }

    public destroy() {
        this.renderHelper.destroy();
    }
}

export class FFXIVRenderer implements Viewer.SceneGfx {
    globals: RenderGlobals;
    private terrainRenderer: TerrainRenderer;
    private lgbRenderers: (LayoutObjectsRenderer | null)[] = [];
    public textureHolder: TextureListHolder;

    constructor(device: GfxDevice, filesystem: FFXIVFilesystem) {
        const globals = this.globals = new RenderGlobals(device, filesystem);

        for (const [materialPath, material] of filesystem.materials.entries()) {
            const textureName = material?.texture_names[0];
            const texture = globals.filesystem.textures.get(textureName);
            const alpha = (texture == undefined || texture.gfxTexture == null) ? 0.9 : 0.0

            randomColorMap[materialPath] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), alpha);
        }

        console.time("Create model renderers")
        const modelEntries = filesystem.models.entries();
        for (const [path, model] of modelEntries) {
            globals.modelCache[path] = new ModelRenderer(globals, model);
        }
        console.timeEnd("Create model renderers")

        console.time("Create terrain renderer")
        this.terrainRenderer = new TerrainRenderer(globals, this.globals.filesystem.terrain)
        console.timeEnd("Create terrain renderer")

        console.time("Create lgb renderers")
        for (const [lgbPath, lgb] of filesystem.lgbs.entries())
            this.lgbRenderers.push(new LayoutObjectsRenderer(globals, lgb.objects));
        console.timeEnd("Create lgb renderers")
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1 / 60);
    }

    private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1)
        const renderHelper = this.globals.renderHelper;

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.globals.meshGfxProgram);
        template.setMegaStateFlags({cullMode: GfxCullMode.Back});

        setAttachmentStateSimple(template.getMegaStateFlags(), {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);

        renderHelper.renderInstManager.setCurrentList(this.globals.renderInstListMain);

        this.terrainRenderer.prepareToRender(renderHelper.renderInstManager, viewerInput);

        for (let i = 0; i < this.lgbRenderers.length; i++)
            this.lgbRenderers[i]!.prepareToRender(renderHelper.renderInstManager, viewerInput);

        renderHelper.renderInstManager.popTemplate();
        renderHelper.prepareToRender();
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