export type RecipientRole = "ProcurementOfficer" | "WarehousePersonnel";
export type NotificationKind = "ProcurementOrder" | "WarehouseCheck";

export interface NotificationCreateRequest {
  projectId: number;
  materialId?: number;
  recipientRole: RecipientRole;
  kind: NotificationKind;
  message: string;
  quantity?: number;
}

export interface AppNotification {
  id: number;
  recipientRole: RecipientRole;
  projectId: number;
  projectName: string;
  materialId?: number;
  materialName?: string;
  kind: NotificationKind;
  message: string;
  quantity?: number;
  isRead: boolean;
  createdAt: string;
}
