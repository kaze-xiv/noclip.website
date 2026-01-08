import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';

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
import { FFXIVModel, MeshWrapper } from "../../rust/pkg";
import { Color, colorNewFromRGBA, OpaqueBlack, Red } from "../Color";
import { getTriangleCountForTopologyIndexCount, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { FFXIVFilesystem } from "./Filesystem";
import { FakeTextureHolder, TextureMapping } from "../TextureHolder";
import * as UI from "../ui";
import { ScrollSelectItemType } from "../ui";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SceneGraph, SceneGraphCreator, SceneNode } from "./scene";
import { Animator } from "./animate";
import { drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { SgbFile } from "./sgb";
import { DebugSceneGraphPanel } from "./debug";

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
    if (t_DiffuseMapColor.a < .001) discard;
    vec3 t_NormalMap = texture(SAMPLER_2D(u_Texture2), v_TexCoord0.xy).xyz;
    vec3 t_LightDirection2 = normalize(vec3(.2, -1, .5));
    //t_NormalMap.z = 0.5;
    float eDotR = -dot(t_NormalMap, t_LightDirection2);
    //float eDotR = 0.5; // lighting workaround

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

    public vertices: Uint8Array;

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

        this.color = randomColorMap[materialName] ?? OpaqueBlack; // TODO this is because loading a festival messes the state up

        const vertices = this.vertices = mesh.attributes();
        this.vertexBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer)

        const triBytes = mesh.indices();
        this.drawCount = getTriangleCountForTopologyIndexCount(GfxTopology.Triangles, triBytes.length);
        this.triBuffer = createBufferFromData(globals.renderHelper.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, triBytes.buffer);
        this.indexBufferDescriptor = {buffer: this.triBuffer};

        this.vertexBufferDescriptors = [
            {buffer: this.vertexBuffer},
        ];
    }

    public debugDrawVertices(viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4) {
        const view = new DataView(this.vertices.buffer);
        const mat = mat4.create();
        const vec = vec3.create();
        mat4.getTranslation(vec, modelMatrix);
        for (let i = 0; i < this.vertices.length; i+=stride) {
            mat4.fromTranslation(mat, [view.getFloat32(i + 0, true), view.getFloat32(i + 4, true), view.getFloat32(i + 8, true)])
            mat4.mul(mat, modelMatrix, mat);
            mat4.getTranslation(vec, mat);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, Red, 2);
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, `${i}`, 0, OpaqueBlack, {font: "12pt monospace"})
        }
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4): void {
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

export class RenderGlobals {
    public meshProgram = new IVProgram();
    public meshGfxProgram: GfxProgram;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public layout: GfxInputLayout;
    public repeatSampler: GfxSampler;

    public modelCache: { [key: string]: ModelRenderer } = {};
    public festivals = new Set<number>();

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
    public scene: SceneGraph;
    public textureHolder: UI.TextureListHolder;
    public animator = new Animator();

    private debugPanel = new DebugSceneGraphPanel();

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
    }

    public setSceneSgb(name: string, sgb: SgbFile) {
        console.time("Create scene")
        const creator = new SceneGraphCreator(this.globals.modelCache, this.globals.filesystem);
        const root = creator.createRootNode();
        root.children = [creator.createSgbSceneNode(name, sgb)];
        this.scene = root;
        console.timeEnd("Create scene")
    }

    public setSceneTerrain() {
        console.time("Create scene")
        const creator = new SceneGraphCreator(this.globals.modelCache, this.globals.filesystem);
        const root = creator.createRootNode();
        const children: SceneNode[] = [];
        if (this.globals.filesystem.terrain) {
            children.push(creator.createTerrainSceneNode(this.globals.filesystem.terrain!));
        }

        for (let [name, lgb] of this.globals.filesystem.lgbs) {
            children.push(creator.createLgbSceneNode(name, lgb));
        }
        root.children = children;
        this.scene = root;
        console.timeEnd("Create scene")
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

        this.animator.animate(this.scene, viewerInput.time);

        this.prepareToRenderScene(viewerInput);

        renderHelper.renderInstManager.popTemplate();
        renderHelper.prepareToRender();
    }

    public prepareToRenderScene(viewerInput: Viewer.ViewerRenderInput) {
        this.prepareToRenderNode(mat4.create(), this.scene, viewerInput);
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
        return [this.createFestivalPanel(), this.debugPanel.createPanel(this.scene)];
    }

    createFestivalPanel(): UI.Panel {
        const ret = new UI.Panel();
        ret.setTitle(UI.LAYER_ICON, "Festivals")
        const x = new UI.SingleSelect();
        const festivalIdsPresent = [...this.globals.festivals].sort((a, b) => a - b);
        const items = festivalIdsPresent.map((id) => festivals[id] ?? `Unknown festival ${id}`);
        x.setItems(items.map(x => ({type: ScrollSelectItemType.Selectable, name: `${x}`})));
        x.onselectionchange = (index: number) => {
            const festivalId = festivalIdsPresent[index];
            this.globals.filesystem.loadFestival([...this.globals.filesystem.lgbs.values()], festivalId).then(() => {
                const filesystem = this.globals.filesystem;
                const globals = this.globals;

                processTextures(this.globals.renderHelper.device, this.globals.filesystem);

                for (const [materialPath, material] of filesystem.materials.entries()) {
                    const textureName = material?.texture_names[0];
                    const texture = globals.filesystem.textures.get(textureName);
                    const alpha = (texture == undefined || texture.gfxTexture == null) ? 0.9 : 0.0

                    randomColorMap[materialPath] = colorNewFromRGBA(Math.random(), Math.random(), Math.random(), alpha);
                }

                console.time("Create model renderers")
                const modelEntries = filesystem.models.entries();
                for (const [path, model] of modelEntries) {
                    if (globals.modelCache[path]) continue;
                    globals.modelCache[path] = new ModelRenderer(globals, model);
                }
                console.timeEnd("Create model renderers")

                // const objects = [...this.globals.filesystem.lgbs.values()].flatMap(x => x.objects).filter(x => x.festival_id == festivalId);
                // this.festivalRenderer = new LayoutObjectsRenderer(this.globals, objects);
                console.log("Loaded festival", festivalId);
            });
        }
        ret.contents.appendChild(x.elem);

        return ret;
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

const festivals: { [ids: number]: string | undefined } = {
    50: "bg_newyear2018_00",
    51: "bg_china2018_00",
    52: "bg_korea2018_00",
    58: "bg_halloween2017_00",
    61: "bg_newyear2019_00",
    62: "bg_china2019_00",
    63: "bg_korea2019_00",
    64: "bg_valentine2018_00",
    65: "bg_princess2018_00",
    66: "bg_easter2018_00",
    70: "bg_goldsaucer2018_00",
    71: "bg_summer2018_00",
    72: "bg_anniversary2018_00",
    76: "bg_halloween2018_00",
    77: "bg_christmas2018_00",
    79: "bg_newyear2020_00",
    80: "bg_china2020_00",
    81: "bg_korea2020_00",
    82: "bg_valentine2019_00",
    83: "bg_princess2019_00",
    85: "bg_easter2019_00",
    86: "bg_goldsaucer2019_00",
    89: "bg_summer2019_00",
    90: "bg_anniversary2019_00",
    91: "bg_halloween2019_00",
    95: "bg_christmas2019_00",
    97: "bg_newyear2021_00",
    98: "bg_china2021_00",
    99: "bg_korea2021_00",
    100: "bg_valentine2020_00,bg_valentine2020_01,bg_valentine2020_02,bg_valentine2020_03,bg_valentine2020_04,bg_valentine2020_05",
    103: "bg_princess2020_00",
    104: "bg_easter2020_00",
    105: "bg_goldsaucer2020_00",
    106: "bg_summer2020_00",
    107: "bg_anniversary2020_00",
    108: "bg_christmas2020_00",
    110: "bg_newyear2022_00",
    111: "bg_china2022_00",
    112: "bg_korea2022_00",
    113: "bg_val_pri2021_00",
    114: "bg_easter2021_00",
    115: "bg_goldsaucer2021_00",
    116: "bg_summer2021_00",
    117: "bg_anniversary2021_00",
    118: "bg_halloween2021_00",
    121: "bg_christmas2021_00",
    122: "bg_valentine2022_00",
    123: "bg_princess2022_00",
    124: "bg_easter2022_00",
    125: "bg_goldsaucer2022_00",
    126: "bg_summer2022_00",
    127: "bg_anniversary2022_00",
    129: "bg_newyear2023_00",
    130: "bg_china2023_00",
    131: "bg_korea2023_00",
    132: "bg_halloween2022_00",
    133: "bg_christmas2022_00",
    134: "bg_china2024_00,bg_korea2024_00,bg_newyear2024_00",
    135: "bg_valentine2023_00",
    136: "bg_easter2023_00",
    138: "bg_princess2023_00",
    139: "bg_goldsaucer2023_00",
    140: "bg_summer2023_00",
    141: "bg_anniversary2023_00",
    142: "bg_halloween2023_00",
    143: "bg_christmas2023_00",
    144: "bg_valentine2024_00",
    145: "bg_pri_eas2024_01,bg_pri_eas2024_02",
    146: "bg_goldsaucer2024_00",
    149: "bg_china2025_00,bg_korea2025_00,bg_newyear2025_00",
    150: "bg_summer2024_00",
    151: "bg_anniversary2024_00",
    152: "bg_halloween2024_00",
    153: "bg_christmas2024_00",
    154: "bg_valentine2025_00",
    155: "bg_princess2025_00",
    156: "bg_easter2025_00",
    157: "bg_china2026_00,bg_korea2026_00,bg_newyear2026_00",
    159: "bg_summer2025_00",
    161: "bg_goldsaucer2025_00",
    162: "bg_anniversary2025_00",
    163: "bg_valentine2026_00",
    164: "bg_halloween2025_00",
    165: "bg_christmas2025_00",
    167: "bg_china2027_00,bg_korea2027_00,bg_newyear2027_00",
    169: "bg_princess2026_00",
    172: "bg_easter2026_00",
    173: "bg_goldsaucer2026_00",
    174: "bg_summer2026_00",
    175: "bg_anniversary2026_00",


}