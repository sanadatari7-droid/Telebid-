import { create } from "zustand"
import { persist } from "zustand/middleware"

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null, accessToken: null, refreshToken: null, isAuthenticated: false,
      setAuth: (loginResponse) => {
        const { user, access_token, refresh_token } = loginResponse
        localStorage.setItem("access_token", access_token)
        localStorage.setItem("refresh_token", refresh_token)
        set({ user, accessToken: access_token, refreshToken: refresh_token, isAuthenticated: true })
      },
      clearAuth: () => {
        localStorage.removeItem("access_token")
        localStorage.removeItem("refresh_token")
        set({ user:null, accessToken:null, refreshToken:null, isAuthenticated:false })
      },
      hasRole: (...roles) => roles.some(r => get().user?.roles?.includes(r))
    }),
    { name:"telebid-auth", partialize: s => ({ user:s.user, isAuthenticated:s.isAuthenticated }) }
  )
)
