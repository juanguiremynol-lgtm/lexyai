// ItemDetail - Redirects to the unified WorkItemDetail page
import { Navigate, useParams } from "react-router-dom";

export default function ItemDetail() {
  const { id } = useParams();
  
  // Redirect to unified work-items detail
  if (id) {
    return <Navigate to={`/app/work-items/${id}`} replace />;
  }
  
  return <Navigate to="/app/dashboard" replace />;
}
