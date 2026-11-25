import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "../auth/sessionContext.js";
import Login from "../pages/Login/Login";

const Home = lazy(() => import("../pages/Home/Home"));
const Borrow = lazy(() => import("../pages/Borrow/Borrow"));
const MyPage = lazy(() => import("../pages/MyPage/MyPage"));
const Info = lazy(() => import("../pages/MyPage/ChangeInfo"));
const Return = lazy(() => import("../pages/Return/Return"));
const UserManage = lazy(() => import("../pages/UserManage/UserManage"));

function RequireSession() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="home-loading" role="status">
        <div className="home-loading__orbit" aria-hidden="true" />
        <p>세션을 확인하고 있어요...</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/Login" state={{ from: location.pathname }} replace />;
  return (
    <Suspense fallback={<div className="home-loading" role="status">화면을 불러오고 있어요...</div>}>
      <Outlet key={user.id} />
    </Suspense>
  );
}

function RequireAdmin() {
  const { user } = useSession();
  if (!user.isAdmin) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<div className="home-loading" role="status">관리자 화면을 불러오고 있어요...</div>}>
      <Outlet />
    </Suspense>
  );
}

export default function Router() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/Login" element={<Login />} />
        <Route element={<RequireSession />}>
          <Route path="/" element={<Home />} />
          <Route path="/Borrow" element={<Borrow />} />
          <Route path="/MyPage" element={<MyPage />} />
          <Route path="/Info" element={<Info />} />
          <Route path="/Return" element={<Return />} />
          <Route element={<RequireAdmin />}>
            <Route path="/UserManage" element={<UserManage />} />
            <Route path="/admin" element={<UserManage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
