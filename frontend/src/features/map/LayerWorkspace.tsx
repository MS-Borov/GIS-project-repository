import { useEffect, useMemo, useRef, useState } from "react";
import { featureSelectionKey } from "./selection";
import type { SelectedLayerFeature } from "./selection";
import {
  LegendClassSymbol,
  colorWithOpacity,
  defaultLayerStyle,
  layerGeometryKind,
  normalizeLayerStyle,
  previewAttributeFields,
} from "./layerStyles";
import type { GeoJsonPreview, LayerClassificationClass, LayerPreviewState, LayerStyleSettings, SubmissionAsset } from "./layerStyles";
import { LayerPropertiesWindow, SymbolEditorWindow } from "../layer-properties/LayerPropertyWindows";
import { MultiLayerMapPanel } from "./MultiLayerMapPanel";
import {
  DEFAULT_LAYER_GROUP,
  LOCAL_LAYER_GROUP,
  MAP_COORDINATE_PROJECTIONS,
  RUSSIA_PREVIEW_QUERY,
  SHAPEFILE_PART_EXTENSIONS,
  ThemeIconButton,
  defaultLabelField,
  fileExtension,
  isPreviewableAsset,
  layerDisplayName,
  layerMatchKey,
  normalizeGeoJsonFeatureCollection,
  openMapViewer,
  qgisLayerForAsset,
  qgisLayerOrder,
  qgisProjectExtent3857,
  statusLabel,
  storedAuthFetchJson,
  stringOrNull,
  uniqueLayerAssets,
} from "./mapWorkspaceUtils";
import type {
  Assignment,
  ArchivePreviewResponse,
  LayerLayoutSnapshot,
  LayerStyleManifest,
  LayerStyleManifestLayer,
  MapWindowKey,
  QgisProjectMetadata,
  Submission,
  ThemeMode,
} from "./mapWorkspaceUtils";

function styleManifestMatchKey(value: string | null | undefined) {
  return layerDisplayName(String(value ?? ""))
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .trim()
    .toLowerCase();
}

function styleManifestLayerForAsset(
  manifest: LayerStyleManifest | null | undefined,
  asset: SubmissionAsset,
): LayerStyleManifestLayer | null {
  const assetKey = styleManifestMatchKey(asset.asset_name);
  if (!assetKey || !manifest?.layers?.length) {
    return null;
  }
  return manifest.layers.find((layer) => {
    const candidates = [layer.asset_name, layer.export_stem, layer.source_layer_name, layer.alias];
    return candidates.some((candidate) => {
      const key = styleManifestMatchKey(candidate);
      return key && (key === assetKey || assetKey.startsWith(`${key}_`) || key.startsWith(`${assetKey}_`));
    });
  }) ?? null;
}

export function LayerWorkspace(props: {
  selectedSubmissionId: number | null;
  workspaceAssignment?: Assignment | null;
  workspaceTitle?: string;
  submissions: Submission[];
  assets: SubmissionAsset[];
  preloadedPreviews?: GeoJsonPreview[];
  qgisProject?: QgisProjectMetadata | null;
  isLoading: boolean;
  onSubmissionSelect: (id: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  isStandalone?: boolean;
  isAssignmentWorkspace?: boolean;
  autoLoadLayers?: boolean;
  autoLoadDraft?: boolean;
  hideHeader?: boolean;
  allowDraftSubmit?: boolean;
  onDraftSubmitted?: (submission: Submission) => void | Promise<void>;
  themeMode?: ThemeMode;
  onThemeToggle?: () => void;
}
) {
  const localLayerInputRef = useRef<HTMLInputElement | null>(null);
  const localLayerFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [layers, setLayers] = useState<LayerPreviewState[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<SelectedLayerFeature>(null);
  const [loadingLayerIds, setLoadingLayerIds] = useState<number[]>([]);
  const [layerErrors, setLayerErrors] = useState<Record<number, string>>({});
  const [draggedLayerId, setDraggedLayerId] = useState<number | null>(null);
  const [layerMenuId, setLayerMenuId] = useState<number | null>(null);
  const [layerMenuPosition, setLayerMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [groupMenuName, setGroupMenuName] = useState<string | null>(null);
  const [groupMenuPosition, setGroupMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [layerPropertiesId, setLayerPropertiesId] = useState<number | null>(null);
  const [layerPropertiesPosition, setLayerPropertiesPosition] = useState({ x: 390, y: 70 });
  const [layerPropertiesDragOffset, setLayerPropertiesDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [symbolEditor, setSymbolEditor] = useState<{
    assetId: number;
    classIndex: number;
    position: { x: number; y: number };
  } | null>(null);
  const [expandedLayerId] = useState<number | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<number[]>([]);
  const [removedLayerIds, setRemovedLayerIds] = useState<number[]>([]);
  const [tableLayerId, setTableLayerId] = useState<number | null>(null);
  const [isTableWindowOpen, setIsTableWindowOpen] = useState(false);
  const [isDraftEditingEnabled, setIsDraftEditingEnabled] = useState(false);
  const [activeEditableLayerId, setActiveEditableLayerId] = useState<number | null>(null);
  const [zoomToLayerId, setZoomToLayerId] = useState<number | null>(null);
  const [zoomToLayerTick, setZoomToLayerTick] = useState(0);
  const [localLayerStatus, setLocalLayerStatus] = useState<string | null>(null);
  const [layerGroupNames, setLayerGroupNames] = useState<string[]>([DEFAULT_LAYER_GROUP]);
  const [layerGroups, setLayerGroups] = useState<Record<number, string>>({});
  const [collapsedLayerGroups, setCollapsedLayerGroups] = useState<string[]>([]);
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupDraft, setEditingGroupDraft] = useState("");
  const [newLayerGroupName, setNewLayerGroupName] = useState("");
  const [renamingLayerId, setRenamingLayerId] = useState<number | null>(null);
  const [layerAliases, setLayerAliases] = useState<Record<number, string>>({});
  const [assignedLayerCrs, setAssignedLayerCrs] = useState<Record<number, string>>({});
  const [layerStyles, setLayerStyles] = useState<Record<number, LayerStyleSettings>>({});
  const [localQgisProject, setLocalQgisProject] = useState<QgisProjectMetadata | null>(null);
  const [layerLayoutHistory, setLayerLayoutHistory] = useState<LayerLayoutSnapshot[]>([]);
  const [layerLayoutFuture, setLayerLayoutFuture] = useState<LayerLayoutSnapshot[]>([]);
  const [windowZIndexes, setWindowZIndexes] = useState<Record<MapWindowKey, number>>({
    layerProperties: 22,
    table: 23,
    draftProperties: 24,
    symbolEditor: 25,
  });
  const nextWindowZIndexRef = useRef(30);
  const groupRenameInputRef = useRef<HTMLInputElement | null>(null);
  const autoLoadedLayersKeyRef = useRef<string | null>(null);
  const qgisProject = localQgisProject ?? props.qgisProject ?? null;
  const qgisExtent3857 = useMemo(() => qgisProjectExtent3857(qgisProject), [qgisProject]);
  const previewableAssets = uniqueLayerAssets(props.assets.filter(isPreviewableAsset), qgisProject);
  const visiblePreviewableAssets = previewableAssets.filter(
    (asset) => !hiddenLayerIds.includes(asset.id) && !removedLayerIds.includes(asset.id),
  );
  const previewableAssetKey = previewableAssets.map((asset) => asset.id).join(",");
  const dedupedLayers = uniqueLayerAssets(layers.map((layer) => layer.asset), qgisProject)
    .map((asset) => layers.find((layer) => layer.asset.id === asset.id))
    .filter((layer): layer is LayerPreviewState => Boolean(layer));
  const loadedLayerIds = new Set(dedupedLayers.map((layer) => layer.asset.id));
  const loadedLayerKeys = new Set(dedupedLayers.map((layer) => layerMatchKey(layer.asset.asset_name)));
  const orderedAssets = [
    ...dedupedLayers
      .filter((layer) => !hiddenLayerIds.includes(layer.asset.id) && !removedLayerIds.includes(layer.asset.id))
      .map((layer) => layer.asset),
    ...visiblePreviewableAssets.filter((asset) => !loadedLayerIds.has(asset.id) && !loadedLayerKeys.has(layerMatchKey(asset.asset_name))),
  ];
  const selectedSubmission = props.submissions.find((submission) => submission.id === props.selectedSubmissionId) ?? null;
  const workspaceAssignmentId = props.workspaceAssignment?.id ?? selectedSubmission?.assignment_id ?? null;
  const layerGroupStorageKey = [
    "gis_edu_layer_groups",
    props.isAssignmentWorkspace ? "assignment" : props.selectedSubmissionId ? "submission" : "workspace",
    props.workspaceAssignment?.id ?? props.selectedSubmissionId ?? props.workspaceTitle ?? "default",
  ].join(":");
  const workspaceIsOpen = Boolean(
    props.selectedSubmissionId ||
      props.workspaceAssignment ||
      props.workspaceTitle ||
      props.preloadedPreviews?.length,
  );
  const propertiesLayer = layerPropertiesId
    ? layers.find((layer) => layer.asset.id === layerPropertiesId) ?? null
    : null;
  const symbolEditorLayer = symbolEditor
    ? layers.find((layer) => layer.asset.id === symbolEditor.assetId) ?? null
    : null;
  const symbolEditorLayerIndex = symbolEditorLayer ? layers.findIndex((layer) => layer.asset.id === symbolEditorLayer.asset.id) : -1;
  const symbolEditorStyle = symbolEditorLayer
    ? normalizeLayerStyle(layerStyles[symbolEditorLayer.asset.id], symbolEditorLayerIndex)
    : null;
  const symbolEditorClass =
    symbolEditor && symbolEditorStyle?.classification
      ? symbolEditorStyle.classification.classes[symbolEditor.classIndex] ?? null
      : null;
  const allLoadedLayersVisible = layers.length > 0 && layers.every((layer) => layer.visible);
  const activeEditableLayer = activeEditableLayerId
    ? layers.find((layer) => layer.asset.id === activeEditableLayerId) ?? null
    : null;
  const allLayerGroupNames = Array.from(
    new Set([DEFAULT_LAYER_GROUP, ...layerGroupNames, ...orderedAssets.map((asset) => layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP)]),
  );
  const groupedAssets = allLayerGroupNames
    .map((groupName) => ({
      groupName,
      assets: orderedAssets.filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName),
    }))
    .filter((group) => group.assets.length > 0 || group.groupName !== DEFAULT_LAYER_GROUP);

  useEffect(() => {
    setLayers([]);
    setSelectedFeature(null);
    setLayerErrors({});
    setLoadingLayerIds([]);
    setDraggedLayerId(null);
    setLayerMenuId(null);
    setLayerMenuPosition(null);
    setGroupMenuName(null);
    setGroupMenuPosition(null);
    setLayerPropertiesId(null);
    setLayerPropertiesDragOffset(null);
    setSymbolEditor(null);
    setHiddenLayerIds([]);
    setRemovedLayerIds([]);
    setTableLayerId(null);
    setIsTableWindowOpen(false);
    setIsDraftEditingEnabled(false);
    setActiveEditableLayerId(null);
    setZoomToLayerId(null);
    setZoomToLayerTick(0);
    setLocalLayerStatus(null);
    setLocalQgisProject(null);
    try {
      const savedGroups = JSON.parse(localStorage.getItem(layerGroupStorageKey) ?? "{}") as {
        names?: string[];
        assignments?: Record<number, string>;
        collapsed?: string[];
        aliases?: Record<number, string>;
        assignedCrs?: Record<number, string>;
        styles?: Record<number, LayerStyleSettings>;
      };
      setLayerGroupNames(savedGroups.names?.length ? Array.from(new Set([DEFAULT_LAYER_GROUP, ...savedGroups.names])) : [DEFAULT_LAYER_GROUP]);
      setLayerGroups(savedGroups.assignments ?? {});
      setCollapsedLayerGroups(savedGroups.collapsed ?? []);
      setLayerAliases(savedGroups.aliases ?? {});
      setAssignedLayerCrs(savedGroups.assignedCrs ?? {});
      setLayerStyles(savedGroups.styles ?? {});
    } catch {
      setLayerGroupNames([DEFAULT_LAYER_GROUP]);
      setLayerGroups({});
      setCollapsedLayerGroups([]);
      setLayerAliases({});
      setAssignedLayerCrs({});
      setLayerStyles({});
    }
    setEditingGroupName(null);
    setEditingGroupDraft("");
    setRenamingLayerId(null);
    setLayerLayoutHistory([]);
    setLayerLayoutFuture([]);
    autoLoadedLayersKeyRef.current = null;
  }, [props.selectedSubmissionId, layerGroupStorageKey]);

  useEffect(() => {
    if (!workspaceIsOpen) {
      return;
    }
    localStorage.setItem(
      layerGroupStorageKey,
      JSON.stringify({
        names: layerGroupNames,
        assignments: layerGroups,
        collapsed: collapsedLayerGroups,
        aliases: layerAliases,
        assignedCrs: assignedLayerCrs,
        styles: layerStyles,
      }),
    );
  }, [workspaceIsOpen, layerGroupStorageKey, layerGroupNames, layerGroups, collapsedLayerGroups, layerAliases, assignedLayerCrs, layerStyles]);

  useEffect(() => {
    if (!editingGroupName) {
      return;
    }
    groupRenameInputRef.current?.focus();
    groupRenameInputRef.current?.select();
  }, [editingGroupName]);

  useEffect(() => {
    if (!qgisProject?.layers?.length || previewableAssets.length === 0) {
      return;
    }
    const nextAliases: Record<number, string> = {};
    const nextStyles: Record<number, LayerStyleSettings> = {};
    previewableAssets.forEach((asset, index) => {
      const qgisLayer = qgisLayerForAsset(qgisProject, asset);
      if (qgisLayer?.name) {
        nextAliases[asset.id] = qgisLayer.name;
      }
      if (qgisLayer?.style) {
        nextStyles[asset.id] = normalizeLayerStyle(qgisLayer.style, index);
      }
    });
    setLayerAliases((current) => ({ ...current, ...nextAliases }));
    setLayerStyles((current) => ({ ...current, ...nextStyles }));
    setLayers((current) =>
      uniqueLayerAssets(current.map((layer) => layer.asset), qgisProject)
        .map((asset) => current.find((layer) => layer.asset.id === asset.id))
        .filter((layer): layer is LayerPreviewState => Boolean(layer))
        .map((layer) => {
          const qgisLayer = qgisLayerForAsset(qgisProject, layer.asset);
          return qgisLayer ? { ...layer, visible: qgisLayer.visible !== false } : layer;
        })
        .sort((left, right) => qgisLayerOrder(qgisProject, left.asset) - qgisLayerOrder(qgisProject, right.asset)),
    );
  }, [qgisProject, previewableAssetKey]);

  async function loadLayer(asset: SubmissionAsset) {
    if (layers.some((layer) => layer.asset.id === asset.id || layerMatchKey(layer.asset.asset_name) === layerMatchKey(asset.asset_name))) {
      setLayers((current) =>
        current.map((layer) =>
          layer.asset.id === asset.id || layerMatchKey(layer.asset.asset_name) === layerMatchKey(asset.asset_name)
            ? { ...layer, visible: true }
            : layer,
        ),
      );
      return;
    }

    setLoadingLayerIds((current) => [...current, asset.id]);
    setLayerErrors((current) => {
      const next = { ...current };
      delete next[asset.id];
      return next;
    });

    try {
      const preview =
        props.preloadedPreviews?.find((item) => item.asset_id === asset.id) ??
        (await props.onFetchAssetPreview(asset.id));
      const qgisLayer = qgisLayerForAsset(qgisProject, asset);
      if (qgisLayer?.name) {
        setLayerAliases((current) => ({ ...current, [asset.id]: current[asset.id] ?? qgisLayer.name }));
      }
      if (qgisLayer?.style) {
        setLayerStyles((current) => ({
          ...current,
          [asset.id]: normalizeLayerStyle(qgisLayer.style ?? undefined, previewableAssets.findIndex((item) => item.id === asset.id)),
        }));
      }
      setLayers((current) => [
        ...current,
        {
          asset,
          preview,
          visible: qgisLayer?.visible !== false,
          labelsVisible: false,
          labelField: defaultLabelField(preview),
        },
      ]);
      if (preview.geojson.features.length > 0) {
        setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
      }
    } catch (error) {
      setLayerErrors((current) => ({
        ...current,
        [asset.id]: error instanceof Error ? error.message : "Не удалось открыть слой.",
      }));
    } finally {
      setLoadingLayerIds((current) => current.filter((id) => id !== asset.id));
    }
  }

  async function loadAllLayers() {
    const loadedKeys = new Set(layers.map((layer) => layerMatchKey(layer.asset.asset_name)));
    for (const asset of visiblePreviewableAssets) {
      const assetKey = layerMatchKey(asset.asset_name);
      if (!layers.some((layer) => layer.asset.id === asset.id) && !loadedKeys.has(assetKey)) {
        await loadLayer(asset);
        loadedKeys.add(assetKey);
      }
    }
  }

  useEffect(() => {
    if (!props.autoLoadLayers || !workspaceIsOpen || previewableAssets.length === 0) {
      return;
    }
    if (autoLoadedLayersKeyRef.current === previewableAssetKey) {
      return;
    }
    autoLoadedLayersKeyRef.current = previewableAssetKey;
    void loadAllLayers();
  }, [props.autoLoadLayers, workspaceIsOpen, previewableAssetKey]);

  function toggleLayer(assetId: number) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, visible: !layer.visible } : layer,
      ),
    );
  }

  function toggleAllLoadedLayers() {
    const nextVisible = !allLoadedLayersVisible;
    rememberLayerLayout();
    setLayers((current) => current.map((layer) => ({ ...layer, visible: nextVisible })));
  }

  function toggleLayerGroupVisibility(groupName: string) {
    const groupLayerIds = layers
      .filter((layer) => (layerGroups[layer.asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((layer) => layer.asset.id);
    if (groupLayerIds.length === 0) {
      return;
    }
    rememberLayerLayout();
    const groupIsVisible = layers
      .filter((layer) => groupLayerIds.includes(layer.asset.id))
      .every((layer) => layer.visible);
    setLayers((current) =>
      current.map((layer) =>
        groupLayerIds.includes(layer.asset.id) ? { ...layer, visible: !groupIsVisible } : layer,
      ),
    );
  }

  function uniqueLayerGroupName(baseName: string) {
    let index = 1;
    let candidate = baseName;
    while (layerGroupNames.includes(candidate)) {
      index += 1;
      candidate = `${baseName} ${index}`;
    }
    return candidate;
  }

  function addLayerGroup() {
    rememberLayerLayout();
    const groupName = uniqueLayerGroupName("Новая группа");
    setLayerGroupNames((current) => [...current, groupName]);
    setCollapsedLayerGroups((current) => current.filter((name) => name !== groupName));
    setEditingGroupName(groupName);
    setEditingGroupDraft(groupName);
  }

  function commitLayerGroupRename() {
    if (!editingGroupName) {
      return;
    }
    const nextName = editingGroupDraft.trim() || editingGroupName;
    const duplicate = layerGroupNames.some((name) => name !== editingGroupName && name === nextName);
    if (duplicate || nextName === editingGroupName) {
      setEditingGroupName(null);
      setEditingGroupDraft("");
      return;
    }
    rememberLayerLayout();
    setLayerGroupNames((current) => current.map((name) => (name === editingGroupName ? nextName : name)));
    setLayerGroups((current) =>
      Object.fromEntries(
        Object.entries(current).map(([assetId, groupName]) => [
          assetId,
          groupName === editingGroupName ? nextName : groupName,
        ]),
      ),
    );
    setCollapsedLayerGroups((current) => current.map((name) => (name === editingGroupName ? nextName : name)));
    setEditingGroupName(null);
    setEditingGroupDraft("");
  }

  function toggleLayerGroupCollapse(groupName: string) {
    rememberLayerLayout();
    setCollapsedLayerGroups((current) =>
      current.includes(groupName)
        ? current.filter((name) => name !== groupName)
        : [...current, groupName],
    );
  }

  function deleteLayerGroup(groupName: string) {
    if (groupName === DEFAULT_LAYER_GROUP) {
      closeGroupMenu();
      return;
    }
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    rememberLayerLayout();
    setLayers((current) => current.filter((layer) => !groupAssetIds.includes(layer.asset.id)));
    setRemovedLayerIds((current) => Array.from(new Set([...current, ...groupAssetIds])));
    setHiddenLayerIds((current) => current.filter((assetId) => !groupAssetIds.includes(assetId)));
    setLayerGroupNames((current) => current.filter((name) => name !== groupName));
    setLayerGroups((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setLayerAliases((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setLayerStyles((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setCollapsedLayerGroups((current) => current.filter((name) => name !== groupName));
    if (editingGroupName === groupName) {
      setEditingGroupName(null);
      setEditingGroupDraft("");
    }
    closeGroupMenu();
  }

  function setAssetLayerGroup(assetId: number, groupName: string) {
    rememberLayerLayout();
    setLayerGroupNames((current) => (current.includes(groupName) ? current : [...current, groupName]));
    setLayerGroups((current) => ({ ...current, [assetId]: groupName || DEFAULT_LAYER_GROUP }));
  }

  function setLayerAssignedCrs(assetId: number, crs: string) {
    rememberLayerLayout();
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      if (crs) {
        next[assetId] = crs;
      } else {
        delete next[assetId];
      }
      return next;
    });
  }

  function setLayerStyle(assetId: number, patch: Partial<LayerStyleSettings>) {
    const layerIndex = Math.max(0, layers.findIndex((layer) => layer.asset.id === assetId));
    rememberLayerLayout();
    setLayerStyles((current) => ({
      ...current,
      [assetId]: normalizeLayerStyle({ ...(current[assetId] ?? defaultLayerStyle(layerIndex)), ...patch }, layerIndex),
    }));
  }

  function applyLayerProperties(
    assetId: number,
    changes: {
      assignedCrs: string;
      labelsVisible: boolean;
      labelField: string | null;
      layerStyle: LayerStyleSettings;
    },
  ) {
    const layerIndex = Math.max(0, layers.findIndex((layer) => layer.asset.id === assetId));
    rememberLayerLayout();
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      if (changes.assignedCrs) {
        next[assetId] = changes.assignedCrs;
      } else {
        delete next[assetId];
      }
      return next;
    });
    setLayerStyles((current) => ({
      ...current,
      [assetId]: normalizeLayerStyle(changes.layerStyle, layerIndex),
    }));
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId
          ? {
              ...layer,
              labelField: changes.labelField,
              labelsVisible: Boolean(changes.labelField) && changes.labelsVisible,
            }
          : layer,
      ),
    );
  }

  function updateLayerClassificationClass(assetId: number, classIndex: number, patch: Partial<LayerClassificationClass>) {
    const layerIndex = Math.max(0, layers.findIndex((layer) => layer.asset.id === assetId));
    rememberLayerLayout();
    setLayerStyles((current) => {
      const style = normalizeLayerStyle(current[assetId], layerIndex);
      const classification = style.classification;
      if (!classification) {
        return current;
      }
      return {
        ...current,
        [assetId]: {
          ...style,
          classification: {
            ...classification,
            classes: classification.classes.map((item, index) =>
              index === classIndex ? { ...item, ...patch } : item,
            ),
          },
        },
      };
    });
  }

  function openSymbolEditor(assetId: number, classIndex: number, clientX: number, clientY: number) {
    setSymbolEditor({
      assetId,
      classIndex,
      position: {
        x: Math.max(16, Math.min(clientX, window.innerWidth - 520)),
        y: Math.max(16, Math.min(clientY, window.innerHeight - 560)),
      },
    });
    bringWindowToFront("symbolEditor");
  }

  function groupAssignedCrsValue(groupName: string) {
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    const assignedValues = Array.from(
      new Set(groupAssetIds.map((assetId) => assignedLayerCrs[assetId]).filter(Boolean)),
    );
    if (assignedValues.length === 0) {
      return "";
    }
    return assignedValues.length === 1 ? assignedValues[0] : "__mixed__";
  }

  function setGroupAssignedCrs(groupName: string, crs: string) {
    if (crs === "__mixed__") {
      return;
    }
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    if (groupAssetIds.length === 0) {
      return;
    }
    rememberLayerLayout();
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        if (crs) {
          next[assetId] = crs;
        } else {
          delete next[assetId];
        }
      });
      return next;
    });
  }

  function dropLayerIntoGroup(groupName: string) {
    if (!draggedLayerId) {
      return;
    }
    setAssetLayerGroup(draggedLayerId, groupName);
    setDraggedLayerId(null);
  }

  function commitLayerAlias(assetId: number, value: string) {
    const alias = value.trim();
    rememberLayerLayout();
    setLayerAliases((current) => {
      const next = { ...current };
      if (alias) {
        next[assetId] = alias;
      } else {
        delete next[assetId];
      }
      return next;
    });
    setRenamingLayerId(null);
  }

  function hideLayer(assetId: number) {
    rememberLayerLayout();
    setLayers((current) => current.filter((layer) => layer.asset.id !== assetId));
    setRemovedLayerIds((current) => (current.includes(assetId) ? current : [...current, assetId]));
    setHiddenLayerIds((current) => current.filter((id) => id !== assetId));
    setSelectedFeature((current) => (current?.assetId === assetId ? null : current));
    setLayerPropertiesId((current) => (current === assetId ? null : current));
    setTableLayerId((current) => (current === assetId ? null : current));
    setLayerMenuId((current) => (current === assetId ? null : current));
    if (activeEditableLayerId === assetId) {
      setActiveEditableLayerId(null);
      setIsDraftEditingEnabled(false);
    }
    setLayerGroups((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setLayerStyles((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }

  function hideLayerFromList(assetId: number) {
    rememberLayerLayout();
    setHiddenLayerIds((current) => (current.includes(assetId) ? current : [...current, assetId]));
    setLayers((current) =>
      current.map((layer) => (layer.asset.id === assetId ? { ...layer, visible: false } : layer)),
    );
    setSelectedFeature((current) => (current?.assetId === assetId ? null : current));
    setLayerPropertiesId((current) => (current === assetId ? null : current));
    setTableLayerId((current) => (current === assetId ? null : current));
    setLayerMenuId((current) => (current === assetId ? null : current));
    if (activeEditableLayerId === assetId) {
      setActiveEditableLayerId(null);
      setIsDraftEditingEnabled(false);
    }
  }

  function addLocalPreviewLayer(asset: SubmissionAsset, preview: GeoJsonPreview, groupName = LOCAL_LAYER_GROUP) {
    rememberLayerLayout();
    setLayerGroupNames((current) => (current.includes(groupName) ? current : [...current, groupName]));
    setLayerGroups((current) => ({ ...current, [asset.id]: groupName }));
    setRemovedLayerIds((current) => current.filter((id) => id !== asset.id));
    setLayers((current) => [
      ...current.filter((layer) => layer.asset.id !== asset.id),
      {
        asset,
        preview,
        visible: true,
        labelsVisible: false,
        labelField: defaultLabelField(preview),
      },
    ]);
    setHiddenLayerIds((current) => current.filter((id) => id !== asset.id));
    if (preview.geojson.features.length > 0) {
      setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
    }
  }

  function createEmptyEditableLayer() {
    if (!workspaceIsOpen) {
      return;
    }
    const name = window.prompt("Название нового слоя", "Новый слой")?.trim();
    if (!name) {
      return;
    }
    const availableGroups = allLayerGroupNames.length > 0 ? allLayerGroupNames : [DEFAULT_LAYER_GROUP];
    const groupInput = window.prompt(
      `Группа слоя (${availableGroups.join(", ")})`,
      availableGroups[0] ?? DEFAULT_LAYER_GROUP,
    )?.trim();
    const groupName = groupInput || DEFAULT_LAYER_GROUP;
    const assetId = -Date.now();
    const asset: SubmissionAsset = {
      id: assetId,
      submission_id: 0,
      asset_name: `${name}.geojson`,
      asset_type: "layer",
      detected_format: "geojson",
      status: "uploaded",
      message: "Пустой слой создан в рабочей карте.",
    };
    const preview: GeoJsonPreview = {
      asset_id: assetId,
      asset_name: asset.asset_name,
      detected_format: "geojson",
      source_crs: "EPSG:4326",
      crs: "EPSG:4326",
      feature_count: 0,
      preview_feature_count: 0,
      truncated: false,
      geojson: { type: "FeatureCollection", features: [] },
    };
    addLocalPreviewLayer(asset, preview, groupName);
    setLayerAliases((current) => ({ ...current, [assetId]: name }));
    setActiveEditableLayerId(assetId);
    setIsDraftEditingEnabled(true);
    setTableLayerId(assetId);
    setIsTableWindowOpen(true);
    bringWindowToFront("table");
    setLocalLayerStatus(`Создан пустой слой «${name}».`);
  }

  async function loadLocalLayerFile(file: File) {
    setLocalLayerStatus(`Загрузка слоя «${file.name}»...`);
    try {
      if (file.name.toLowerCase().endsWith(".geojson") || file.type.includes("json")) {
        const geojson = normalizeGeoJsonFeatureCollection(JSON.parse(await file.text()));
        const assetId = -Date.now();
        const asset: SubmissionAsset = {
          id: assetId,
          submission_id: 0,
          asset_name: file.name,
          asset_type: "layer",
          detected_format: "geojson",
          status: "uploaded",
          message: "Локальный GeoJSON загружен в рабочую карту.",
        };
        const preview: GeoJsonPreview = {
          asset_id: assetId,
          asset_name: file.name,
          detected_format: "geojson",
          source_crs: "EPSG:4326",
          crs: "EPSG:4326",
          feature_count: geojson.features.length,
          preview_feature_count: geojson.features.length,
          truncated: false,
          geojson,
        };
        addLocalPreviewLayer(asset, preview);
        setLocalLayerStatus(`Локальный GeoJSON загружен: ${geojson.features.length} объектов.`);
        return;
      }

      if (!file.name.toLowerCase().endsWith(".zip")) {
        throw new Error("Пока поддерживаются GeoJSON и ZIP с GIS-слоями.");
      }
      if (!workspaceAssignmentId) {
        throw new Error("Для ZIP-preview нужен открытый workspace задания.");
      }

      const formData = new FormData();
      formData.append("assignment_id", String(workspaceAssignmentId));
      formData.append("file", file);
      const archivePreview = await storedAuthFetchJson<ArchivePreviewResponse>("/submissions/archive-preview", {
        method: "POST",
        body: formData,
      });
      setLocalQgisProject(archivePreview.qgis_project ?? null);

      let loadedCount = 0;
      const localAssets = uniqueLayerAssets(archivePreview.assets.filter(isPreviewableAsset), archivePreview.qgis_project);
      for (const asset of localAssets) {
        const tempPreview = await storedAuthFetchJson<GeoJsonPreview>(
          `/submissions/archive-preview/${archivePreview.preview_token}/assets/${asset.id}/geojson-preview?${RUSSIA_PREVIEW_QUERY}`,
        );
        const assetId = -(Date.now() + asset.id + loadedCount);
        const localAsset = {
          ...asset,
          id: assetId,
          submission_id: 0,
          asset_name: layerDisplayName(asset.asset_name),
          status: "uploaded",
          message: "Локальный ZIP-слой загружен в рабочую карту.",
        };
        const qgisLayer = qgisLayerForAsset(archivePreview.qgis_project, asset);
        const manifestLayer = styleManifestLayerForAsset(archivePreview.style_manifest, asset);
        addLocalPreviewLayer(localAsset, {
          ...tempPreview,
          asset_id: assetId,
          asset_name: localAsset.asset_name,
        }, manifestLayer?.group_name || LOCAL_LAYER_GROUP);
        const layerAlias = manifestLayer?.alias || manifestLayer?.source_layer_name || qgisLayer?.name;
        if (layerAlias) {
          setLayerAliases((current) => ({ ...current, [assetId]: layerAlias }));
        }
        const layerStyle = manifestLayer?.style || qgisLayer?.style;
        if (layerStyle) {
          setLayerStyles((current) => ({ ...current, [assetId]: normalizeLayerStyle(layerStyle ?? undefined, loadedCount) }));
        }
        loadedCount += 1;
      }
      setLocalLayerStatus(`Из локального ZIP загружено слоёв: ${loadedCount}.`);
    } catch (error) {
      setLocalLayerStatus(error instanceof Error ? error.message : "Не удалось загрузить локальный слой.");
    }
  }

  async function loadLocalLayerFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }

    if (files.length === 1 && !SHAPEFILE_PART_EXTENSIONS.has(fileExtension(files[0].name))) {
      await loadLocalLayerFile(files[0]);
      return;
    }

    const shapefileParts = files.filter((file) => SHAPEFILE_PART_EXTENSIONS.has(fileExtension(file.name)));
    const directFiles = files.filter((file) => !SHAPEFILE_PART_EXTENSIONS.has(fileExtension(file.name)));

    for (const file of directFiles) {
      if (file.name.toLowerCase().endsWith(".geojson") || file.name.toLowerCase().endsWith(".json") || file.name.toLowerCase().endsWith(".zip")) {
        await loadLocalLayerFile(file);
      }
    }

    if (shapefileParts.length === 0) {
      return;
    }

    const hasShp = shapefileParts.some((file) => fileExtension(file.name) === ".shp");
    if (!hasShp) {
      setLocalLayerStatus("Выберите .shp вместе с файлами комплекта (.dbf, .shx, .prj).");
      return;
    }

    setLocalLayerStatus(`Загрузка shapefile-комплекта: ${shapefileParts.length} файлов...`);
    try {
      const formData = new FormData();
      for (const file of shapefileParts) {
        formData.append("files", file);
      }

      const response = await storedAuthFetchJson<ArchivePreviewResponse>(`/submissions/local-layer-preview?${RUSSIA_PREVIEW_QUERY}`, {
        method: "POST",
        body: formData,
      });

      let loadedCount = 0;
      for (const preview of response.previews ?? []) {
        const asset = response.assets.find((item) => item.id === preview.asset_id);
        if (!asset) {
          continue;
        }
        const assetId = -(Date.now() + asset.id + loadedCount);
        const localAsset = {
          ...asset,
          id: assetId,
          submission_id: 0,
          asset_name: layerDisplayName(asset.asset_name),
          status: "uploaded",
          message: "Локальный shapefile-комплект загружен в рабочую карту.",
        };
        addLocalPreviewLayer(localAsset, {
          ...preview,
          asset_id: assetId,
          asset_name: localAsset.asset_name,
        });
        loadedCount += 1;
      }

      const warningText = response.warnings?.length ? ` Предупреждений: ${response.warnings.length}.` : "";
      setLocalLayerStatus(`Из выбранных shapefile-файлов загружено слоёв: ${loadedCount}.${warningText}`);
    } catch (error) {
      setLocalLayerStatus(error instanceof Error ? error.message : "Не удалось загрузить shapefile-комплект.");
    }
  }

  function dropLayer(targetAssetId: number) {
    if (!draggedLayerId || draggedLayerId === targetAssetId) {
      setDraggedLayerId(null);
      return;
    }

    rememberLayerLayout();
    setLayers((current) => {
      const sourceIndex = current.findIndex((layer) => layer.asset.id === draggedLayerId);
      const targetIndex = current.findIndex((layer) => layer.asset.id === targetAssetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }
      const next = [...current];
      const [movedLayer] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedLayer);
      return next;
    });
    setDraggedLayerId(null);
  }

  function setLayerLabelField(assetId: number, labelField: string | null) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelField, labelsVisible: Boolean(labelField) } : layer,
      ),
    );
  }

  function toggleLayerLabels(assetId: number) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelsVisible: !layer.labelsVisible } : layer,
      ),
    );
  }

  function bringWindowToFront(windowKey: MapWindowKey) {
    nextWindowZIndexRef.current += 1;
    const nextZIndex = nextWindowZIndexRef.current;
    setWindowZIndexes((current) => ({
      ...current,
      [windowKey]: nextZIndex,
    }));
  }

  function currentLayerLayoutSnapshot(): LayerLayoutSnapshot {
    return {
      layers,
      hiddenLayerIds,
      removedLayerIds,
      layerGroupNames,
      layerGroups,
      collapsedLayerGroups,
      layerAliases,
      assignedLayerCrs,
      layerStyles,
    };
  }

  function rememberLayerLayout() {
    const snapshot = currentLayerLayoutSnapshot();
    setLayerLayoutHistory((current) => [...current.slice(-19), snapshot]);
    setLayerLayoutFuture([]);
  }

  function restoreLayerLayout(snapshot: LayerLayoutSnapshot) {
    setLayers(snapshot.layers);
    setHiddenLayerIds(snapshot.hiddenLayerIds);
    setRemovedLayerIds(snapshot.removedLayerIds);
    setLayerGroupNames(snapshot.layerGroupNames);
    setLayerGroups(snapshot.layerGroups);
    setCollapsedLayerGroups(snapshot.collapsedLayerGroups);
    setLayerAliases(snapshot.layerAliases);
    setAssignedLayerCrs(snapshot.assignedLayerCrs);
    setLayerStyles(snapshot.layerStyles);
    setLayerMenuId(null);
    setGroupMenuName(null);
    setSymbolEditor(null);
  }

  function undoLayerLayoutChange() {
    const snapshot = layerLayoutHistory[layerLayoutHistory.length - 1];
    if (!snapshot) {
      return;
    }
    setLayerLayoutFuture((current) => [...current.slice(-19), currentLayerLayoutSnapshot()]);
    setLayerLayoutHistory((current) => current.slice(0, -1));
    restoreLayerLayout(snapshot);
  }

  function redoLayerLayoutChange() {
    const snapshot = layerLayoutFuture[layerLayoutFuture.length - 1];
    if (!snapshot) {
      return;
    }
    setLayerLayoutHistory((current) => [...current.slice(-19), currentLayerLayoutSnapshot()]);
    setLayerLayoutFuture((current) => current.slice(0, -1));
    restoreLayerLayout(snapshot);
  }

  function updateLayerFeatureAttribute(assetId: number, featureIndex: number, field: string, value: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature, index) =>
          index === featureIndex
            ? {
                ...feature,
                properties: {
                  ...(feature.properties ?? {}),
                  [normalizedField]: value,
                },
              }
            : feature,
        );
        return {
          ...layer,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features,
            },
          },
        };
      }),
    );
  }

  function addLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            [normalizedField]: feature.properties?.[normalizedField] ?? "",
          },
        }));
        const nextFeatures =
          features.length > 0
            ? features
            : [
                {
                  type: "Feature" as const,
                  geometry: null,
                  properties: { [normalizedField]: "" },
                },
              ];
        return {
          ...layer,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features: nextFeatures,
            },
          },
        };
      }),
    );
  }

  function removeLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature) => {
          const properties = { ...(feature.properties ?? {}) };
          delete properties[normalizedField];
          return { ...feature, properties };
        });
        return {
          ...layer,
          labelField: layer.labelField === normalizedField ? defaultLabelField({ ...layer.preview, geojson: { ...layer.preview.geojson, features } }) : layer.labelField,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features,
            },
          },
        };
      }),
    );
  }

  function openLayerMenu(assetId: number, x?: number, y?: number) {
    setLayerMenuId(assetId);
    setGroupMenuName(null);
    setGroupMenuPosition(null);
    setLayerMenuPosition(
      typeof x === "number" && typeof y === "number" ? { x, y } : null,
    );
  }

  function closeLayerMenu() {
    setLayerMenuId(null);
    setLayerMenuPosition(null);
  }

  function openGroupMenu(groupName: string, x: number, y: number) {
    setGroupMenuName(groupName);
    setGroupMenuPosition({ x, y });
    setLayerMenuId(null);
    setLayerMenuPosition(null);
  }

  function closeGroupMenu() {
    setGroupMenuName(null);
    setGroupMenuPosition(null);
  }

  useEffect(() => {
    if (!layerPropertiesDragOffset) {
      return;
    }
    const activeDragOffset = layerPropertiesDragOffset;

    function handlePointerMove(event: PointerEvent) {
      const nextX = Math.min(Math.max(8, event.clientX - activeDragOffset.x), Math.max(8, window.innerWidth - 340));
      const nextY = Math.min(Math.max(8, event.clientY - activeDragOffset.y), Math.max(8, window.innerHeight - 160));
      setLayerPropertiesPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
      setLayerPropertiesDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [layerPropertiesDragOffset]);

  useEffect(() => {
    if (!layerMenuId && !groupMenuName) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".layer-action-menu") || target?.closest(".layer-row-tools") || target?.closest(".layer-group-heading")) {
        return;
      }
      closeLayerMenu();
      closeGroupMenu();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [layerMenuId, groupMenuName]);

  return (
    <section className="section-panel">
      {!props.hideHeader ? (
        <div className="section-heading">
          <div>
            <p className="eyebrow">{props.isAssignmentWorkspace ? "Рабочая карта" : "Просмотр ГИС-слоёв"}</p>
            <h2>{props.workspaceTitle ?? (props.isAssignmentWorkspace ? "Рабочая карта задания" : "Слои выбранной сдачи")}</h2>
          </div>
          <div className="button-row">
            {props.selectedSubmissionId && !props.isStandalone ? (
              <button onClick={() => openMapViewer(props.selectedSubmissionId!)}>Открыть карту в новой вкладке</button>
            ) : null}
            <input
              ref={localLayerInputRef}
              type="file"
              className="visually-hidden"
              accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj,.cpg,.qix,.sbn,.sbx"
              multiple
              onChange={(event) => {
                if (event.target.files?.length) {
                  void loadLocalLayerFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <input
              ref={localLayerFolderInputRef}
              type="file"
              className="visually-hidden"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                if (event.target.files?.length) {
                  void loadLocalLayerFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <button onClick={() => localLayerInputRef.current?.click()} disabled={!workspaceIsOpen}>
              Загрузить слой...
            </button>
            <button onClick={() => localLayerFolderInputRef.current?.click()} disabled={!workspaceIsOpen}>
              Загрузить папку...
            </button>
            <button onClick={() => void loadAllLayers()} disabled={props.isLoading || !workspaceIsOpen || visiblePreviewableAssets.length === 0}>
              Загрузить все слои
            </button>
            {props.themeMode && props.onThemeToggle ? (
              <ThemeIconButton themeMode={props.themeMode} onToggle={props.onThemeToggle} className="map-toolbar-theme-switch" />
            ) : null}
          </div>
        </div>
      ) : null}

      {!workspaceIsOpen ? (
        <div className="empty-state">
          <h2>Выберите сдачу</h2>
          <p>Откройте работу студента во вкладке сдач, затем здесь можно будет просмотреть все ГИС-слои на одной карте.</p>
        </div>
      ) : null}

      {workspaceIsOpen ? (
        <div className="layer-workspace">
          <aside className="layer-list">
            <div className="layer-list-heading">
              <div>
                <strong>
                  {props.workspaceTitle ?? props.workspaceAssignment?.title ?? selectedSubmission?.original_filename ?? `Сдача #${props.selectedSubmissionId}`}
                </strong>
                <span>{previewableAssets.length} ГИС-слоёв найдено</span>
              </div>
              <div className="layer-list-actions">
                <button className="slim icon" onClick={addLayerGroup} title="Создать группу слоёв" data-tooltip="Создать группу слоёв">
                  ▣+
                </button>
                <button className="slim icon" onClick={createEmptyEditableLayer} title="Создать новый слой" data-tooltip="Создать новый слой">
                  ◆+
                </button>
                <button
                  className="slim icon"
                  onClick={undoLayerLayoutChange}
                  disabled={layerLayoutHistory.length === 0}
                  title="Отменить изменение списка слоёв"
                  data-tooltip="Отменить изменение списка слоёв"
                >
                  ↶
                </button>
                <button
                  className="slim icon"
                  onClick={redoLayerLayoutChange}
                  disabled={layerLayoutFuture.length === 0}
                  title="Вернуть изменение списка слоёв"
                  data-tooltip="Вернуть изменение списка слоёв"
                >
                  ↷
                </button>
                <button
                  className="slim icon"
                  onClick={toggleAllLoadedLayers}
                  disabled={layers.length === 0}
                  title={allLoadedLayersVisible ? "Выключить все слои" : "Включить все слои"}
                  data-tooltip={allLoadedLayersVisible ? "Выключить все слои" : "Включить все слои"}
                >
                  {allLoadedLayersVisible ? "☑" : "☐"}
                </button>
              </div>
              {hiddenLayerIds.length > 0 ? (
                <button
                  className="slim icon"
                  onClick={() => setHiddenLayerIds([])}
                  title="Показать скрытые слои"
                  data-tooltip="Показать скрытые слои"
                >
                  ◌
                </button>
              ) : null}
            </div>
            {localLayerStatus ? <p className="layer-status">{localLayerStatus}</p> : null}

            {previewableAssets.length === 0 ? (
              <p className="muted">В выбранной сдаче нет GeoJSON или Shapefile ZIP-слоёв для карты.</p>
            ) : null}
            {previewableAssets.length > 0 && visiblePreviewableAssets.length === 0 ? (
              <p className="muted">Все слои скрыты из текущего списка.</p>
            ) : null}

            <div className="layer-group-create hidden">
              <input
                value={editingGroupDraft}
                onChange={(event) => setEditingGroupDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLayerGroup();
                  }
                }}
                placeholder="Новая группа"
              />
              <button onClick={addLayerGroup} disabled={!newLayerGroupName.trim()} title="Создать группу">
                +
              </button>
            </div>

            {groupedAssets.map(({ groupName, assets: groupAssets }) => {
              const collapsed = collapsedLayerGroups.includes(groupName);
              const loadedInGroup = layers.filter(
                (layer) => (layerGroups[layer.asset.id] ?? DEFAULT_LAYER_GROUP) === groupName,
              );
              const groupVisible = loadedInGroup.length > 0 && loadedInGroup.every((layer) => layer.visible);
              return (
                <section className="layer-group" key={groupName}>
                  <div
                    className={draggedLayerId ? "layer-group-heading drop-target" : "layer-group-heading"}
                    onDragOver={(event) => {
                      if (draggedLayerId) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropLayerIntoGroup(groupName);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openGroupMenu(groupName, event.clientX, event.clientY);
                    }}
                  >
                    <button onClick={() => toggleLayerGroupCollapse(groupName)} title={collapsed ? "Развернуть группу" : "Свернуть группу"}>
                      {collapsed ? "▸" : "▾"}
                    </button>
                    {editingGroupName === groupName ? (
                      <input
                        ref={groupRenameInputRef}
                        className="layer-group-name-input"
                        value={editingGroupDraft}
                        onChange={(event) => setEditingGroupDraft(event.target.value)}
                        onBlur={commitLayerGroupRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitLayerGroupRename();
                          }
                          if (event.key === "Escape") {
                            setEditingGroupName(null);
                            setEditingGroupDraft("");
                          }
                        }}
                      />
                    ) : (
                      <strong
                        onDoubleClick={() => {
                          setEditingGroupName(groupName);
                          setEditingGroupDraft(groupName);
                        }}
                      >
                        {groupName}
                      </strong>
                    )}
                    <span>{groupAssets.length}</span>
                    <button onClick={() => toggleLayerGroupVisibility(groupName)} disabled={loadedInGroup.length === 0}>
                      {groupVisible ? "Скрыть" : "Показать"}
                    </button>
                    {groupMenuName === groupName ? (
                      <div
                        className="layer-action-menu fixed"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        style={
                          groupMenuPosition
                            ? { left: groupMenuPosition.x, top: groupMenuPosition.y }
                            : undefined
                        }
                      >
                        <button
                          onClick={() => {
                            setEditingGroupName(groupName);
                            setEditingGroupDraft(groupName);
                            closeGroupMenu();
                          }}
                        >
                          <span className="menu-icon" aria-hidden="true">abc</span>
                          Переименовать группу
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteLayerGroup(groupName);
                          }}
                          disabled={groupName === DEFAULT_LAYER_GROUP}
                        >
                          <span className="menu-icon" aria-hidden="true">×</span>
                          Удалить группу
                        </button>
                        <label className="layer-action-menu-field">
                          <span>СК группы</span>
                          <select
                            value={groupAssignedCrsValue(groupName)}
                            onChange={(event) => setGroupAssignedCrs(groupName, event.target.value)}
                          >
                            <option value="">Не задана</option>
                            <option value="__mixed__" disabled>Разные СК</option>
                            {MAP_COORDINATE_PROJECTIONS.map((projection) => (
                              <option key={projection.code} value={projection.code}>
                                {projection.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                  {!collapsed ? groupAssets.map((asset) => {
              const layer = layers.find((item) => item.asset.id === asset.id);
              const layerIndex = layers.findIndex((item) => item.asset.id === asset.id);
              const isLoadedLocalLayer = asset.submission_id === 0 || asset.id < 0;
              const layerStyle = normalizeLayerStyle(layerStyles[asset.id], layerIndex);
              const geometryKind = layerGeometryKind(layer?.preview);
              const isLoadingLayer = loadingLayerIds.includes(asset.id);
              const fields = layer ? previewAttributeFields(layer.preview) : [];
              const displayName = layerAliases[asset.id] || layerDisplayName(asset.asset_name);
              const isActiveEditableLayer = activeEditableLayerId === asset.id && isDraftEditingEnabled;
              return (
                <div
                  key={asset.id}
                  className={[
                    "layer-row",
                    layer?.visible ? "active" : "",
                    isActiveEditableLayer ? "editing" : "",
                    layer || isLoadedLocalLayer ? "draggable" : "",
                    draggedLayerId === asset.id ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={Boolean(layer) || isLoadedLocalLayer}
                  onDragStart={() => (layer || isLoadedLocalLayer ? setDraggedLayerId(asset.id) : undefined)}
                  onDragOver={(event) => {
                    if ((layer || isLoadedLocalLayer) && draggedLayerId) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={() => (layer || isLoadedLocalLayer ? dropLayer(asset.id) : undefined)}
                  onDragEnd={() => setDraggedLayerId(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!layer) {
                      void loadLayer(asset);
                      return;
                    }
                    openLayerMenu(asset.id, event.clientX, event.clientY);
                  }}
                >
                  <div className="layer-row-main">
                    <label className="layer-visibility-toggle" title="Видимость слоя">
                      <input
                        type="checkbox"
                        checked={Boolean(layer?.visible)}
                        onChange={() => (layer ? toggleLayer(asset.id) : void loadLayer(asset))}
                        disabled={isLoadingLayer}
                      />
                    </label>
                    <span
                      className={[
                        "layer-symbol",
                        `layer-symbol-${geometryKind}`,
                        layer ? "active" : "",
                      ].filter(Boolean).join(" ")}
                      style={{
                        borderColor: layerStyle.strokeColor,
                        background:
                          layer && geometryKind === "polygon"
                            ? colorWithOpacity(layerStyle.fillColor, Math.max(0.12, layerStyle.fillOpacity))
                            : "transparent",
                        color: layerStyle.strokeColor,
                      }}
                      aria-hidden="true"
                    />
                    <div className="layer-title">
                      {renamingLayerId === asset.id ? (
                        <input
                          className="layer-name-input"
                          defaultValue={displayName}
                          autoFocus
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={(event) => commitLayerAlias(asset.id, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitLayerAlias(asset.id, event.currentTarget.value);
                            }
                            if (event.key === "Escape") {
                              setRenamingLayerId(null);
                            }
                          }}
                        />
                      ) : (
                        <strong>{displayName}</strong>
                      )}
                      <small>{isActiveEditableLayer ? "Редактируется" : statusLabel(asset.status)}</small>
                    </div>
                    <div className="layer-row-tools">
                      <button onClick={() => void loadLayer(asset)} disabled={isLoadingLayer} title={layer ? "Обновить слой" : "Открыть слой"}>
                        {layer ? "↻" : isLoadingLayer ? "..." : "+"}
                      </button>
                      <button onClick={() => hideLayerFromList(asset.id)} title="Скрыть слой из списка">
                        ×
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          if (layerMenuId === asset.id) {
                            closeLayerMenu();
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          openLayerMenu(asset.id, Math.max(8, rect.right - 260), rect.bottom + 6);
                        }}
                        disabled={!layer}
                        title="Свойства слоя"
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                  {layer && layerStyle.classification ? (
                    <div className="layer-classification-legend">
                      {layerStyle.classification.classes.map((item, index) => (
                        <span
                          key={`${item.value ?? item.label}-${index}`}
                          onDoubleClick={(event) => openSymbolEditor(asset.id, index, event.clientX, event.clientY)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openSymbolEditor(asset.id, index, event.clientX, event.clientY);
                          }}
                          title="Двойной клик или ПКМ: редактировать знак"
                        >
                          <LegendClassSymbol
                            geometryKind={geometryKind}
                            classItem={item}
                            color={item.color}
                            fillOpacity={item.fillOpacity}
                          />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {layer && layerMenuId === asset.id ? (
                    <div
                      className={layerMenuPosition ? "layer-action-menu fixed" : "layer-action-menu"}
                      style={
                        layerMenuPosition
                          ? { left: layerMenuPosition.x, top: layerMenuPosition.y }
                          : undefined
                      }
                    >
                      <button
                        onClick={() => {
                          setLayerPropertiesId(asset.id);
                          bringWindowToFront("layerProperties");
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">i</span>
                        Расширенная информация
                      </button>
                      <button
                        onClick={() => {
                          setZoomToLayerId(asset.id);
                          setZoomToLayerTick(Date.now());
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">⌕</span>
                        Увеличить до слоя
                      </button>
                      <button
                        onClick={() => {
                          setTableLayerId(asset.id);
                          setIsTableWindowOpen(true);
                          bringWindowToFront("table");
                          if (layer.preview.geojson.features.length > 0) {
                            setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
                          }
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">▦</span>
                        Атрибутивная таблица
                      </button>
                      <button
                        onClick={() => {
                          setActiveEditableLayerId(asset.id);
                          setIsDraftEditingEnabled(true);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">✎</span>
                        Включить редактирование
                      </button>
                      <button
                        onClick={() => {
                          setRenamingLayerId(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">abc</span>
                        Переименовать слой
                      </button>
                      <button
                        onClick={() => {
                          hideLayerFromList(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">◌</span>
                        Скрыть из списка
                      </button>
                      <button
                        onClick={() => {
                          hideLayer(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">×</span>
                        Удалить из рабочей карты
                      </button>
                    </div>
                  ) : null}
                  {layer && expandedLayerId === asset.id ? (
                    <section className="layer-properties">
                      <div className="layer-meta">
                        <span>СК: {layer.preview.crs}</span>
                        <span>Исходная: {layer.preview.source_crs || "не задана"}</span>
                        <span>{layer.preview.preview_feature_count}/{layer.preview.feature_count} объектов</span>
                      </div>
                    </section>
                  ) : null}
                  {layer ? (
                    <div className="layer-label-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={layer.labelsVisible}
                          onChange={() => toggleLayerLabels(asset.id)}
                          disabled={!layer.labelField}
                        />
                        Подписи
                      </label>
                      <select
                        value={layer.labelField ?? ""}
                        onChange={(event) => setLayerLabelField(asset.id, stringOrNull(event.target.value))}
                      >
                        <option value="">Поле подписи не выбрано</option>
                        {fields.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {layerErrors[asset.id] ? <p className="layer-error">{layerErrors[asset.id]}</p> : null}
                </div>
              );
                  }) : null}
                </section>
              );
            })}
          </aside>

          {propertiesLayer ? (
            <LayerPropertiesWindow
              layer={propertiesLayer}
              assignedCrs={assignedLayerCrs[propertiesLayer.asset.id] ?? ""}
              coordinateProjections={MAP_COORDINATE_PROJECTIONS}
              layerStyle={normalizeLayerStyle(
                layerStyles[propertiesLayer.asset.id],
                layers.findIndex((layer) => layer.asset.id === propertiesLayer.asset.id),
              )}
              position={layerPropertiesPosition}
              zIndex={windowZIndexes.layerProperties}
              onFocus={() => bringWindowToFront("layerProperties")}
              onDragStart={(event) => {
                bringWindowToFront("layerProperties");
                setLayerPropertiesDragOffset({
                  x: event.clientX - layerPropertiesPosition.x,
                  y: event.clientY - layerPropertiesPosition.y,
                });
              }}
              onClose={() => setLayerPropertiesId(null)}
              onZoomToLayer={() => {
                setZoomToLayerId(propertiesLayer.asset.id);
                setZoomToLayerTick(Date.now());
              }}
              onOpenTable={() => {
                setTableLayerId(propertiesLayer.asset.id);
                setIsTableWindowOpen(true);
                bringWindowToFront("table");
                if (propertiesLayer.preview.geojson.features.length > 0) {
                  setSelectedFeature({ assetId: propertiesLayer.asset.id, featureIndex: 0 });
                }
              }}
              onApplyChanges={(changes) => applyLayerProperties(propertiesLayer.asset.id, changes)}
            />
          ) : null}

          {symbolEditor && symbolEditorLayer && symbolEditorClass ? (
            <SymbolEditorWindow
              layerName={layerAliases[symbolEditorLayer.asset.id] || layerDisplayName(symbolEditorLayer.asset.asset_name)}
              geometryKind={layerGeometryKind(symbolEditorLayer.preview)}
              classItem={symbolEditorClass}
              position={symbolEditor.position}
              zIndex={windowZIndexes.symbolEditor}
              onFocus={() => bringWindowToFront("symbolEditor")}
              onClose={() => setSymbolEditor(null)}
              onUpdate={(patch) => updateLayerClassificationClass(symbolEditorLayer.asset.id, symbolEditor.classIndex, patch)}
            />
          ) : null}

          <MultiLayerMapPanel
            layers={layers}
            layerStyles={layerStyles}
            assignmentId={props.workspaceAssignment?.id ?? selectedSubmission?.assignment_id ?? null}
            activeEditableLayerId={activeEditableLayer?.asset.id ?? null}
            activeEditableLayerName={
              activeEditableLayer
                ? layerAliases[activeEditableLayer.asset.id] || layerDisplayName(activeEditableLayer.asset.asset_name)
                : null
            }
            isDraftEditingEnabled={isDraftEditingEnabled}
            onDraftEditingEnabledChange={setIsDraftEditingEnabled}
            zoomToLayerId={zoomToLayerId}
            zoomToLayerTick={zoomToLayerTick}
            tableLayerId={tableLayerId}
            layerAliases={layerAliases}
            isTableWindowOpen={isTableWindowOpen}
            selectedFeature={selectedFeature}
            onFeatureSelect={setSelectedFeature}
            onLayerFeatureAttributeChange={updateLayerFeatureAttribute}
            onLayerAttributeFieldAdd={addLayerAttributeField}
            onLayerAttributeFieldRemove={removeLayerAttributeField}
            windowZIndexes={windowZIndexes}
            onWindowFocus={bringWindowToFront}
            onCloseTable={() => setIsTableWindowOpen(false)}
            autoLoadDraft={props.autoLoadDraft}
            allowDraftSubmit={Boolean(props.allowDraftSubmit)}
            onDraftSubmitted={props.onDraftSubmitted}
            projectExtent3857={qgisExtent3857}
            hideBasemap={Boolean(qgisProject?.hide_basemap)}
            coordinateProjections={MAP_COORDINATE_PROJECTIONS}
          />
        </div>
      ) : null}
    </section>
  );
}
