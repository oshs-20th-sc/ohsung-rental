import Header from "../../components/header";
import Content from "../../components/content";
import Footer from "../../components/footer";
import "./Home.css";

function Home() {
  return (
    <div className="home-page">
      <Header />
      <main className="home-main">
        <Content />
      </main>
      <Footer />
    </div>
  );
}

export default Home;
