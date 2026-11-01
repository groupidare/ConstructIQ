export type UserRole =
  | "Admin"
  | "ProjectManager"
  | "SiteEngineer"
  | "WarehousePersonnel"
  | "ProcurementOfficer";

export interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl?: string | null;
  mfaEnabled?: boolean;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceId?: string;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
}

export interface LoginSuccessResponse {
  mfaRequired?: false;
  token: string;
  user: User;
  expiresAt: string;
}

export type LoginResponse = MfaChallengeResponse | LoginSuccessResponse;

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}
