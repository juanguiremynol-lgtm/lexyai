// ItemRedirect - Redirects legacy routes to work-items
import { Navigate, useParams } from "react-router-dom";

export default function ItemRedirect() {
  const { id } = useParams();
  
  if (id) {
    return <Navigate to={`/app/work-items/${id}`} replace />;
  }
  
  return <Navigate to="/app/dashboard" replace />;
}
