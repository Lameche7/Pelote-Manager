export type AuthUser = {
  id: string;
  email: string;
};

export type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
};
