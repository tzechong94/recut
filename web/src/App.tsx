import { useState } from "react";
import "./styles.css";
import { Projects } from "./pages/Projects";
import { Editor } from "./pages/Editor";
import { RecipeLibrary } from "./pages/RecipeLibrary";
import { api } from "./api/client";
import type { Project, Recipe } from "./types";

type View =
  | { name: "projects" }
  | { name: "library" }
  | {
      name: "editor";
      projectId: string;
      projectName: string;
      seedRecipe: Recipe | null;
    };

const TONES = ["#5B3DF5", "#FF5C49", "#7B5CFF", "#0FB5A6", "#F5A524"];

export default function App() {
  const [view, setView] = useState<View>({ name: "projects" });

  const open = (id: string, name = "Untitled") =>
    setView({
      name: "editor",
      projectId: id,
      projectName: name,
      seedRecipe: null,
    });

  const startFromRecipe = async (recipe: Recipe) => {
    const tone = TONES[Math.floor(Math.random() * TONES.length)];
    let project: Project;
    try {
      project = await api.createProject({
        name: recipe.name || "From recipe",
        tone,
      });
    } catch {
      const now = new Date().toISOString();
      project = {
        id: "local-" + Date.now().toString(36),
        name: recipe.name || "From recipe",
        stage: 1,
        tone,
        token_cap: 100000,
        created_at: now,
        updated_at: now,
      };
    }
    setView({
      name: "editor",
      projectId: project.id,
      projectName: project.name,
      seedRecipe: recipe,
    });
  };

  return (
    <div className="rc-root">
      {view.name === "projects" && (
        <Projects
          open={(id) => open(id)}
          openLibrary={() => setView({ name: "library" })}
        />
      )}
      {view.name === "library" && (
        <RecipeLibrary
          exit={() => setView({ name: "projects" })}
          startFromRecipe={startFromRecipe}
        />
      )}
      {view.name === "editor" && (
        <Editor
          key={view.projectId}
          projectId={view.projectId}
          projectName={view.projectName}
          seedRecipe={view.seedRecipe}
          exit={() => setView({ name: "projects" })}
        />
      )}
    </div>
  );
}
