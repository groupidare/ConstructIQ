export type RecipientRole = "Admin" | "ProjectManager" | "SiteEngineer" | "WarehousePersonnel" | "ProcurementOfficer";

export type NotificationKind =
  | "ProcurementOrder" | "WarehouseCheck"
  | "Weather" | "WeatherApiDown"
  | "RedistributionRequested" | "RedistributionApproved" | "RedistributionRejected"
  | "ProcurementRequestSubmitted" | "PurchaseOrderCreated" | "PurchaseOrderStatusChanged" | "PurchaseOrderDelayed"
  | "MaterialDelivered" | "PodRatingSubmitted"
  | "UserRegistered" | "UserRoleChanged";

export interface NotificationCreateRequest {
  projectId?: number;
  materialId?: number;
  recipientRole: RecipientRole;
  kind: NotificationKind;
  title?: string;
  message: string;
  actionLink?: string;
  quantity?: number;
}

export interface AppNotification {
  id: number;
  recipientRole: RecipientRole;
  projectId?: number;
  projectName?: string;
  materialId?: number;
  materialName?: string;
  kind: NotificationKind;
  title: string;
  message: string;
  actionLink?: string;
  quantity?: number;
  isRead: boolean;
  createdAt: string;
}
