'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Eye, FileText, Ruler } from 'lucide-react';
import { useDocuments } from '@/hooks/useDocuments';
import { useMeasurements } from '@/hooks/useMeasurements';
import { useBOQ } from '@/hooks/useBOQ';
import { useInventory } from '@/hooks/useInventory';
import { useForecasting } from '@/hooks/useForecasting';
import { useNotifications } from '@/hooks/useNotifications';
import { useProjects } from '@/hooks/useProjects';
import { usePhases } from '@/hooks/usePhases';
import { useAlertStore } from '@/store/alertStore';
import type { Project, ProjectType } from '@/types/project';
import type { MeasurementRow } from '@/types/measurement';
import type { BOQItemRow } from '@/types/boq';
import MeasurementsTab from './MeasurementsTab';
import MaterialPlanTab from './MaterialPlanTab';

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
  const [measurementRows, setMeasurementRows] = useState<MeasurementRow[]>([]);
  const [boqRows, setBoqRows] = useState<BOQItemRow[]>([]);
  const [savingMeasurements, setSavingMeasurements] = useState(false);
  const [savingBoq, setSavingBoq] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [uploadingBlueprint, setUploadingBlueprint] = useState(false);
  const [uploadingBoq, setUploadingBoq] = useState(false);

  const { documents, fetchDocuments, uploadDocument, parseDocument, parseMeasurements, deleteDocument } = useDocuments(project.id);
  const { measurements, fetchMeasurements, saveMeasurements } = useMeasurements(project.id);
  const { items: boqItems, fetchItems: fetchBoqItems, saveItems: saveBoqItems } = useBOQ(project.id);
  const { inventory, fetchInventory } = useInventory(project.id);
  const { forecasts, fetchForecasts, generateForecast } = useForecasting(project.id);
  const { sendNotification } = useNotifications();
  const { editProject } = useProjects();
  const { addPhase } = usePhases();
  const addAlert = useAlertStore(s => s.addAlert);

  const seededMeasurements = useRef(false);
  const seededBoq = useRef(false);

  useEffect(() => {
    fetchDocuments();
    fetchMeasurements();
    fetchBoqItems();
    fetchInventory(true);
    fetchForecasts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (seededMeasurements.current || measurements.length === 0) return;
    seededMeasurements.current = true;
    setMeasurementRows(measurements.map(m => ({
      id: m.id, phaseId: m.phaseId, elementType: m.elementType, areaLabel: m.areaLabel,
      lengthM: m.lengthM, widthM: m.widthM, heightM: m.heightM, thicknessM: m.thicknessM,
      concreteMixRatio: m.concreteMixRatio, wasteAllowancePct: m.wasteAllowancePct,
    })));
  }, [measurements]);

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
  const forecastedMaterials = forecasts[0]?.forecastedMaterials ?? [];

  async function handleUploadBlueprint(file: File) {
    setUploadingBlueprint(true);
    try {
      const doc = await uploadDocument(file, 'Blueprint');
      toast.success('Blueprint uploaded — scanning for dimensions…');
      await scanBlueprintForMeasurements(doc.id);
    } catch {
      toast.error('Failed to upload blueprint.');
    } finally {
      setUploadingBlueprint(false);
    }
  }

  async function scanBlueprintForMeasurements(documentId: number) {
    try {
      const result = await parseMeasurements(documentId);
      if (result.items.length === 0) {
        toast.error('No dimension callouts recognized — enter measurements manually.');
        return;
      }
      setMeasurementRows(prev => [
        ...prev,
        ...result.items.map(item => ({
          phaseId: undefined,
          elementType: (['Wall', 'Column', 'Beam', 'Slab', 'Footing'].includes(item.elementType) ? item.elementType : 'Wall') as MeasurementRow['elementType'],
          areaLabel: item.areaLabel,
          lengthM: item.lengthM, widthM: item.widthM, heightM: item.heightM, thicknessM: item.thicknessM || 0.10,
          concreteMixRatio: '1:2:4', wasteAllowancePct: 12,
          autoScanned: true, sourcePage: item.sourcePage, ocrUsed: item.ocrUsed,
        })),
      ]);
      toast.success(`${result.items.length} measurement(s) auto-scanned — please review and assign a phase to each.`);
      if (result.ocrPagesUsed > 0) toast.error(`${result.ocrPagesUsed} page(s) needed OCR — those rows are lower-confidence.`);
    } catch {
      toast.error('Failed to scan blueprint — enter measurements manually.');
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
        toast.error('No line items detected in that document.');
        return;
      }
      setBoqRows(prev => [
        ...prev,
        ...result.items.map(item => ({
          phaseId: item.phaseHint
            ? project.phases.find(p => p.name.toLowerCase() === item.phaseHint!.toLowerCase())?.id
            : undefined,
          primarySection: 'Others',
          materialId: item.matchedMaterialId,
          newMaterialName: item.matchedMaterialId ? undefined : item.materialName,
          unit: item.unit,
          estimatedQuantity: item.estimatedQuantity,
          notes: 'Auto-scanned',
        })),
      ]);
      toast.success(`${result.items.length} line item(s) scanned — review and edit as needed.`);
      if (result.parseErrors.length > 0) toast.error(result.parseErrors[0]);
    } catch {
      toast.error('Failed to scan document.');
    }
  }

  async function handleSaveMeasurements() {
    if (measurementRows.some(r => !r.phaseId)) {
      toast.error('Assign a phase to every measurement row before saving.');
      return;
    }
    setSavingMeasurements(true);
    try {
      await editProject(project.id, {
        name: project.name, type: projectType, otherTypeSpecify: projectType === 'Others' ? otherTypeSpecify : undefined,
        location: project.location, description: project.description, budget: project.budget,
        startDate: project.startDate, targetEndDate: project.targetEndDate,
        assignedContractor: project.assignedContractor, siteEngineerId: project.siteEngineerId,
        phases: [],
      });
      await saveMeasurements(measurementRows);
      onProjectSaved?.({ ...project, type: projectType, otherTypeSpecify });
      toast.success('Measurements saved.');
    } catch {
      toast.error('Failed to save measurements.');
    } finally {
      setSavingMeasurements(false);
    }
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
      await generateForecast({ projectId: project.id, period: 'Monthly', planningWeeks: 4 });
      toast.success('Forecast generated.');
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

  async function handleAddPhase(name: string) {
    if (!name.trim()) { toast.error('Phase name is required.'); return; }
    try {
      const newPhase = await addPhase({
        projectId: project.id, name: name.trim(),
        startDate: project.startDate, endDate: project.targetEndDate,
      });
      onProjectSaved?.({ ...project, phases: [...project.phases, newPhase] });
      toast.success(`Phase "${newPhase.name}" added.`);
    } catch {
      toast.error('Failed to add phase.');
    }
  }

  return {
    tab, setTab, editable, setEditable,
    projectType, otherTypeSpecify, setProjectType: (t: ProjectType, o: string) => { setProjectType(t); setOtherTypeSpecify(o); },
    measurementRows, setMeasurementRows, boqRows, setBoqRows,
    blueprints, boqDocs, inventory, forecastedMaterials,
    savingMeasurements, savingBoq, forecasting, uploadingBlueprint, uploadingBoq,
    handleUploadBlueprint, handleUploadBoq, handleParseBoq, handleAddPhase, handleRemoveDocument,
    handleSaveMeasurements, handleSaveBoq, handleRunForecast, handleNotify,
  };
}

export function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabBtn = (t: Tab, label: string, Icon: typeof Ruler) => (
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
      {tabBtn('measurements', 'Measurements', Ruler)}
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
      project={project}
      editable={state.editable}
      projectType={state.projectType}
      otherTypeSpecify={state.otherTypeSpecify}
      onProjectTypeChange={state.setProjectType}
      blueprints={state.blueprints}
      uploading={state.uploadingBlueprint}
      onUploadBlueprint={state.handleUploadBlueprint}
      rows={state.measurementRows}
      onRowsChange={state.setMeasurementRows}
      onSave={state.handleSaveMeasurements}
      saving={state.savingMeasurements}
      onRunForecast={state.handleRunForecast}
      forecasting={state.forecasting}
      onAddPhase={state.handleAddPhase}
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
      onRowsChange={state.setBoqRows}
      onSave={state.handleSaveBoq}
      saving={state.savingBoq}
      onNotify={state.handleNotify}
    />
  );
}
