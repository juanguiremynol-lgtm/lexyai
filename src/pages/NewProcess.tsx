// NewProcess - Redirects to the unified creation wizard
import { Navigate } from "react-router-dom";

export default function NewProcess() {
  // Redirect to dashboard where the creation wizard is accessible
  return <Navigate to="/app/dashboard" replace />;
}
