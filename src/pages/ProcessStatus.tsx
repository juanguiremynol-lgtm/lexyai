// ProcessStatus - Redirects to the work-items list
import { Navigate } from "react-router-dom";

export default function ProcessStatus() {
  return <Navigate to="/app/work-items" replace />;
}
