import { useState } from "react";
import AdminDashboard from "./admin/AdminDashboard.jsx";
import RentalManagement from "./admin/RentalManagement.jsx";
import ProductManagement from "./admin/ProductManagement.jsx";
import "./UM_content.css";

const tabs = [
  { id: "rentals", label: "대여 현황", description: "대여와 반납 관리" },
  { id: "products", label: "물품 관리", description: "재고 등록과 수정" },
  { id: "summary", label: "운영 요약", description: "현재 재고 현황" },
];

export default function AdminConsole() {
  const [activeTab, setActiveTab] = useState("rentals");

  return (
    <div className="UMcontent">
      <div className="UMcontent__body">
        <header className="UMcontent__header">
          <div>
            <span className="UMcontent__eyebrow">빌리러 오성</span>
            <h1>관리자 콘솔</h1>
            <p>대여 흐름과 물품 재고를 확인하고 관리합니다.</p>
          </div>
        </header>

        <nav className="UMcontent__tabs" aria-label="관리자 메뉴" role="tablist">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                id={`admin-tab-${tab.id}`}
                role="tab"
                aria-selected={active}
                aria-controls={`admin-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                className={`UMcontent__tab${active ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const current = tabs.findIndex((item) => item.id === activeTab);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  setActiveTab(tabs[next].id);
                  requestAnimationFrame(() => document.getElementById(`admin-tab-${tabs[next].id}`)?.focus());
                }}
              >
                <span>{tab.label}</span>
                <small>{tab.description}</small>
              </button>
            );
          })}
        </nav>

        {tabs.map((tab) => (
          <section
            key={tab.id}
            className="UMcontent__panel"
            id={`admin-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`admin-tab-${tab.id}`}
            tabIndex={0}
            hidden={activeTab !== tab.id}
          >
            {activeTab === tab.id && tab.id === "rentals" && <RentalManagement />}
            {activeTab === tab.id && tab.id === "products" && <ProductManagement />}
            {activeTab === tab.id && tab.id === "summary" && <AdminDashboard />}
          </section>
        ))}
      </div>
    </div>
  );
}
