import "./UserManage.css";
import { useSession } from "../../auth/sessionContext.js";
import Header from "../../components/header";
import Content from "../../components/UM_content";

function UserManage() {
  const { user } = useSession();
  return (
    <div className="UserManage">
      <Header />
      <main className="UserManage__content">
        <Content />
      </main>
    </div>
  );
}

export default UserManage;
