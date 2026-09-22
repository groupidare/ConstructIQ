'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Eye, FileText, Folder } from 'lucide-react';
import { useDocuments } from '@/hooks/useDocuments';
import { useBOQ } from '@/hooks/useBOQ';
import { useInventory } from '@/hooks/useInventory';
import { useForecasting } from '@/hooks/useForecasting';
import { useNotifications } from '@/hooks/useNotifications';
import { useProjects } from '@/hooks/useProjects';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useAlertStore } from '@/store/alertStore';
import type { Project, ProjectType } from '@/types/project';
import type { BOQItemRow } from '@/types/boq';
import type { PurchaseOrderMaterial } from '@/types/purchaseOrder';
import MeasurementsTab from './MeasurementsTab';
import MaterialPlanTab from './MaterialPlanTab';

function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || fallback;
}

export type Tab = 'measurements' | 'materialPlan';

export interface ShellProps {
  project: Project;
  initialEditable?: boolean;
  initialTab?: Tab;
  onProjectSaved?: (p: Project) => void;
  showEditToggle?: boolean;
  headerExtra?: React.ReactNode;
}

export function useMeasurementsAndMaterialPlan({ project, initialEditable = true, initialTab = 'measurements', onProjectSaved }: ShellProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editable, setEditable] = useState(initialEditable);

  const [projectType, setProjectType] = useState<ProjectType>(project.type);
  const [otherTypeSpecify, setOtherTypeSpecify] = useState(project.otherTypeSpecify ?? '');
  const [savingProjectType, setSavingProjectType] = useState(false);
  const [boqRows, setBoqRows] = useState<BOQItemRow[]>([]);
  const [savingBoq, setSavingBoq] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [uploadingBlueprint, setUploadingBlueprint] = useState(false);
  const [parsingBlueprintId, setParsingBlueprintId] = useState<number | null>(null);
  const [uploadingBoq, setUploadingBoq] = useState(false);
  const [uploadingPo, setUploadingPo] = useState(false);
  const [savingPo, setSavingPo] = useState(false);
  const [poDraftRows, setPoDraftRows] = useState<PurchaseOrderMaterial[]>([]);
  const [poSupplierName, setPoSupplierName] = useState('');
  const [poOrderDate, setPoOrderDate] = useState('');
  const [poExpectedDate, setPoExpectedDate] = useState('');

  const { documents, fetchDocuments, uploadDocument, parseDocument, parsePO, deleteDocument } = useDocuments(project.id);
  const { items: boqItems, fetchItems: fetchBoqItems, saveItems: saveBoqItems } = useBOQ(project.id);
  const { inventory, fetchInventory } = useInventory(project.id);
  const { forecasts, fetchForecasts, generateForecast } = useForecasting(project.id);
  const { sendNotification } = useNotifications();
  const { editProject } = useProjects();
  const { items: purchaseOrders, fetchItems: fetchPurchaseOrders, createOrder, linkMaterial } = usePurchaseOrders(project.id);
  const addAlert = useAlertStore(s => s.addAlert);

  const seededBoq = useRef(false);

  useEffect(() => {
    fetchDocuments();
    fetchBoqItems();
    fetchInventory(true);
    fetchForecasts();
    fetchPurchaseOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (seededBoq.current || boqItems.length === 0) return;
    seededBoq.current = true;
    setBoqRows(boqItems.map(b => ({
      id: b.id, phaseId: b.phaseId, primarySection: b.primarySection, subCategory: b.subCategory,
      materialId: b.materialId, unit: b.unit, estimatedQuantity: b.estimatedQuantity, actualQuantity: b.actualQuantity, notes: b.notes,
    })));
  }, [boqItems]);

  const blueprints = documents.filter(d => d.category === 'Blueprint');
  const boqDocs = documents.filter(d => d.category === 'BOQ');
  const poDocs = documents.filter(d => d.category === 'PurchaseOrder');
  const forecastedMaterials = forecasts[0]?.forecastedMaterials ?? [];

  async function handleUploadBlueprint(file: File) {
    setUploadingBlueprint(true);
    try {
      await uploadDocument(file, 'Blueprint');
      toast.success('Blueprint uploaded.');
    } catch {
      toast.error('Failed to upload blueprint.');
    } finally {
      setUploadingBlueprint(false);
    }
  }

  async function handleUploadBoq(file: File) {
    setUploadingBoq(true);
    try {
      await uploadDocument(file, 'BOQ');
      toast.success(`${file.name} uploaded.`);
    } catch {
      toast.error(`Failed to upload ${file.name}.`);
    } finally {
      setUploadingBoq(false);
    }
  }

  async function handleRemoveDocument(documentId: number) {
    try {
      await deleteDocument(documentId);
      toast.success('File removed.');
    } catch {
      toast.error('Failed to remove file.');
    }
  }

  async function handleParseBoq(documentId: number) {
    try {
      const result = await parseDocument(documentId);
      if (result.items.length === 0) {
        toast.error(result.parseErrors[0] || 'No line items detected in that document.');
        return;
      }
      setBoqRows(prev => [
        ...prev,
        ...result.items.map(item => ({
          phaseId: item.phaseHint
            ? project.phases.find(p => p.name.toLowerCase() === item.phaseHint!.toLowerCase())?.id
            : undefined,
          primarySection: item.primarySection || 'Others',
          subCategory: item.subCategory,
          materialId: item.matchedMaterialId,
          // Keep the scanned name even when a catalog match was found — it's
          // the only display text available until this row is saved and the
          // real catalog name comes back from the backend on refetch.
          newMaterialName: item.materialName,
          unit: item.unit,
          estimatedQuantity: item.estimatedQuantity,
          notes: 'Auto-scanned',
        })),
      ]);
      toast.success(`${result.items.length} line item(s) scanned — review and edit as needed.`);
      if (result.parseErrors.length > 0) toast.error(result.parseErrors[0]);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to scan document.'));
    }
  }

  async function handleParseBlueprint(documentId: number) {
    setParsingBlueprintId(documentId);
    try {
      await handleParseBoq(documentId);
    } finally {
      setParsingBlueprintId(null);
    }
  }

  async function handleUploadPO(file: File) {
    setUploadingPo(true);
    try {
      await uploadDocument(file, 'PurchaseOrder');
      toast.success(`${file.name} uploaded.`);
    } catch {
      toast.error(`Failed to upload ${file.name}.`);
    } finally {
      setUploadingPo(false);
    }
  }

  async function handleParsePO(documentId: number) {
    try {
      const result = await parsePO(documentId);
      if (result.items.length === 0) {
        toast.error(result.parseErrors[0] || 'No line items detected in that document.');
        return;
      }
      const first = result.items[0];
      setPoSupplierName(prev => prev || first.supplierName || '');
      setPoOrderDate(prev => prev || first.orderDate || '');
      setPoExpectedDate(prev => prev || first.promisedDeliveryDate || '');
      setPoDraftRows(prev => [
        ...prev,
        ...result.items.map(item => ({
          name: item.materialName,
          quantity: item.actualQuantityOrdered,
          unit: item.unit,
          materialId: item.matchedMaterialId,
        })),
      ]);
      toast.success(`${result.items.length} line item(s) scanned — review and edit as needed.`);
      if (result.parseErrors.length > 0) toast.error(result.parseErrors[0]);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to scan document.'));
    }
  }

  async function handleSavePO() {
    if (!poSupplierName.trim()) { toast.error('Supplier name is required.'); return; }
    if (!poExpectedDate) { toast.error('Expected delivery date is required.'); return; }
    if (poDraftRows.length === 0) { toast.error('Add at least one material.'); return; }

    setSavingPo(true);
    try {
      await createOrder({
        projectId: project.id,
        supplierName: poSupplierName.trim(),
        orderDate: poOrderDate || undefined,
        expectedDate: poExpectedDate,
        materials: poDraftRows,
      });
      setPoDraftRows([]);
      setPoSupplierName('');
      setPoOrderDate('');
      setPoExpectedDate('');
      toast.success('Purchase order created.');
    } catch {
      toast.error('Failed to create purchase order.');
    } finally {
      setSavingPo(false);
    }
  }

  async function handleLinkPoMaterial(materialId: number, boqItemId: number | null) {
    try {
      await linkMaterial(materialId, boqItemId);
      await fetchPurchaseOrders();
      toast.success(boqItemId ? 'Linked to BOQ line.' : 'Link removed.');
    } catch {
      toast.error('Failed to update link.');
    }
  }

  async function persistProjectType(type: ProjectType, otherSpecify: string) {
    setSavingProjectType(true);
    try {
      await editProject(project.id, {
        name: project.name, type, otherTypeSpecify: type === 'Others' ? otherSpecify : undefined,
        location: project.location, description: project.description, budget: project.budget,
        startDate: project.startDate, targetEndDate: project.targetEndDate,
        assignedContractor: project.assignedContractor, siteEngineerId: project.siteEngineerId,
        phases: [],
      });
      onProjectSaved?.({ ...project, type, otherTypeSpecify: otherSpecify });
      toast.success('Project type saved.');
    } catch {
      toast.error('Failed to save project type.');
    } finally {
      setSavingProjectType(false);
    }
  }

  function handleProjectTypeChange(type: ProjectType, otherSpecify: string) {
    setProjectType(type);
    setOtherTypeSpecify(otherSpecify);
    if (type !== 'Others') persistProjectType(type, otherSpecify);
  }

  function handleOtherTypeSpecifyBlur() {
    if (projectType === 'Others') persistProjectType(projectType, otherTypeSpecify);
  }

  async function handleSaveBoq() {
    setSavingBoq(true);
    try {
      await saveBoqItems(boqRows);
      toast.success('Material plan saved.');
    } catch {
      toast.error('Failed to save material plan.');
    } finally {
      setSavingBoq(false);
    }
  }

  async function handleRunForecast() {
    setForecasting(true);
    try {
      // Run Forecast should reflect exactly what's on screen — save any
      // reviewed/edited BOQ rows first so a forecast never silently runs
      // against stale (or missing) data just because "Save Material Plan"
      // wasn't clicked separately first.
      if (boqRows.length > 0) {
        await saveBoqItems(boqRows);
      }
      await generateForecast({ projectId: project.id, period: 'Monthly', planningWeeks: 4 });
      toast.success('Material plan saved and forecast generated.');
      setTab('materialPlan');
    } catch {
      toast.error('Failed to generate forecast — no historical or BOQ data available yet.');
    } finally {
      setForecasting(false);
    }
  }

  async function handleNotify(kind: 'ProcurementOrder' | 'WarehouseCheck', materialId: number | undefined, materialName: string, quantity: number) {
    const isProcurement = kind === 'ProcurementOrder';
    const message = isProcurement
      ? `${materialName}: order ${quantity.toLocaleString()} more for "${project.name}".`
      : `Please verify stock/quality of ${materialName} for "${project.name}".`;
    try {
      await sendNotification({
        projectId: project.id, materialId,
        recipientRole: isProcurement ? 'ProcurementOfficer' : 'WarehousePersonnel',
        kind, message, quantity: isProcurement ? quantity : undefined,
      });
      addAlert({
        kind: isProcurement ? 'delay' : 'overstock',
        title: isProcurement ? 'Procurement Alert' : 'Warehouse Alert',
        body: message,
      });
      toast.success(isProcurement ? 'Procurement notified.' : 'Warehouse notified.');
    } catch {
      toast.error('Failed to send notification.');
    }
  }

  return {
    tab, setTab, editable, setEditable,
    projectType, otherTypeSpecify,
    onProjectTypeChange: handleProjectTypeChange, onOtherTypeSpecifyBlur: handleOtherTypeSpecifyBlur, savingProjectType,
    boqRows, setBoqRows, boqItems,
    blueprints, boqDocs, poDocs, inventory, forecastedMaterials,
    savingBoq, forecasting, uploadingBlueprint, parsingBlueprintId, uploadingBoq, uploadingPo, savingPo,
    handleUploadBlueprint, handleParseBlueprint, handleUploadBoq, handleParseBoq, handleRemoveDocument,
    handleSaveBoq, handleRunForecast, handleNotify,
    purchaseOrders, handleUploadPO, handleParsePO, handleSavePO, handleLinkPoMaterial,
    poDraftRows, setPoDraftRows, poSupplierName, setPoSupplierName,
    poOrderDate, setPoOrderDate, poExpectedDate, setPoExpectedDate,
  };
}

export function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabBtn = (t: Tab, label: string, Icon: typeof Folder) => (
    <button
      onClick={() => setTab(t)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', border: 'none', cursor: 'pointer',
        fontSize: '0.875rem', fontWeight: tab === t ? 700 : 400, background: 'transparent',
        color: tab === t ? '#f97316' : '#9ca3af', borderBottom: tab === t ? '2px solid #f97316' : '2px solid transparent',
      }}
    >
      <Icon style={{ width: 14, height: 14 }} /> {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginTop: '0.75rem' }}>
      {tabBtn('measurements', 'Files', Folder)}
      {tabBtn('materialPlan', 'Material Plan', FileText)}
    </div>
  );
}

export function EditToggle({ editable, onToggle }: { editable: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 999, border: '1px solid #e5e7eb', background: editable ? '#fff7ed' : '#f9fafb', color: editable ? '#f97316' : '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
    >
      {editable ? <Pencil style={{ width: 12, height: 12 }} /> : <Eye style={{ width: 12, height: 12 }} />}
      {editable ? 'Editing' : 'View only'}
    </button>
  );
}

export function TabBody({ project, state }: { project: Project; state: ReturnType<typeof useMeasurementsAndMaterialPlan> }) {
  return state.tab === 'measurements' ? (
    <MeasurementsTab
      editable={state.editable}
      projectType={state.projectType}
      otherTypeSpecify={state.otherTypeSpecify}
      onProjectTypeChange={state.onProjectTypeChange}
      onOtherTypeSpecifyBlur={state.onOtherTypeSpecifyBlur}
      savingProjectType={state.savingProjectType}
      blueprints={state.blueprints}
      uploading={state.uploadingBlueprint}
      onUploadBlueprint={state.handleUploadBlueprint}
      parsingBlueprintId={state.parsingBlueprintId}
      onParseBlueprint={state.handleParseBlueprint}
      onRemoveDocument={state.handleRemoveDocument}
    />
  ) : (
    <MaterialPlanTab
      project={project}
      editable={state.editable}
      projectType={state.projectType}
      otherTypeSpecify={state.otherTypeSpecify}
      inventory={state.inventory}
      forecastedMaterials={state.forecastedMaterials}
      boqDocs={state.boqDocs}
      uploading={state.uploadingBoq}
      onUploadBoq={state.handleUploadBoq}
      onParseBoq={state.handleParseBoq}
      onRemoveDocument={state.handleRemoveDocument}
      rows={state.boqRows}
      boqItems={state.boqItems}
      onRowsChange={state.setBoqRows}
      onSave={state.handleSaveBoq}
      saving={state.savingBoq}
      onNotify={state.handleNotify}
      onRunForecast={state.handleRunForecast}
      forecasting={state.forecasting}
      purchaseOrders={state.purchaseOrders}
      poDocs={state.poDocs}
      uploadingPo={state.uploadingPo}
      savingPo={state.savingPo}
      onUploadPO={state.handleUploadPO}
      onParsePO={state.handleParsePO}
      onSavePO={state.handleSavePO}
      onLinkPoMaterial={state.handleLinkPoMaterial}
      poDraftRows={state.poDraftRows}
      onPoDraftRowsChange={state.setPoDraftRows}
      poSupplierName={state.poSupplierName}
      onPoSupplierNameChange={state.setPoSupplierName}
      poOrderDate={state.poOrderDate}
      onPoOrderDateChange={state.setPoOrderDate}
      poExpectedDate={state.poExpectedDate}
      onPoExpectedDateChange={state.setPoExpectedDate}
    />
  );
}
