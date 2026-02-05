// ProcessStatusDetail - Redirects to unified WorkItemDetail
import { Navigate, useParams } from "react-router-dom";

export default function ProcessStatusDetail() {
  const { id } = useParams();
  
  if (id) {
    return <Navigate to={`/app/work-items/${id}`} replace />;
  }
  
  return <Navigate to="/app/work-items" replace />;
}
