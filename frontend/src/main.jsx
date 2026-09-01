import React, { Component } from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "react-hot-toast"
import App from "./App"
import "./index.css"

const qc = new QueryClient({ defaultOptions: { queries: { retry:1, staleTime:30000 }, mutations: { retry:0 } } })

// Root-level safety net: <App/>'s own ErrorBoundary only wraps routed pages, so a
// render crash in anything else mounted here — <Toaster/> included — would otherwise
// take down the whole React tree to a blank white screen with no way to recover
// short of a manual reload.
class RootErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error, info) { console.error("Fatal app error:", error, info) }
  render() {
    if (this.state.hasError) return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif", padding:"2rem" }}>
        <div style={{ textAlign:"center", maxWidth:420 }}>
          <div style={{ fontSize:40, marginBottom:16 }}>⚠️</div>
          <h1 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>TeleBid Enterprise hit an unexpected error</h1>
          <p style={{ fontSize:14, color:"#6b7280", marginBottom:20 }}>Reloading the page usually fixes this.</p>
          <button onClick={() => window.location.reload()}
            style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontSize:14, cursor:"pointer" }}>
            Reload
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <RootErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <App/>
        <Toaster position="top-right" toastOptions={{
          duration: 4000,
          style: { fontFamily:"Inter,sans-serif", fontSize:"13px" },
          success: { style: { background:"#15803d", color:"#fff" } },
          error:   { style: { background:"#dc2626", color:"#fff" } },
        }}/>
      </QueryClientProvider>
    </BrowserRouter>
  </RootErrorBoundary>
)
