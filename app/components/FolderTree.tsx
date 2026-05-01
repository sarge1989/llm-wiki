import { useState } from "react";
import { Link } from "react-router";
import {
  countFiles,
  type FileNode,
  type FolderNode,
  type TreeNode,
} from "../lib/tree";

export function FolderTree({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="folder-tree">
      {nodes.map((n) =>
        n.type === "folder" ? (
          <FolderRow key={n.path} folder={n} />
        ) : (
          <FileRow key={n.path} file={n} />
        ),
      )}
    </ul>
  );
}

function FolderRow({ folder }: { folder: FolderNode }) {
  const [open, setOpen] = useState(true);
  const count = countFiles(folder);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="folder-row"
      >
        <span className="folder-caret">{open ? "▼" : "▶"}</span>
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{count}</span>
      </button>
      {open && (
        <div className="folder-children">
          <FolderTree nodes={folder.children} />
        </div>
      )}
    </li>
  );
}

function FileRow({ file }: { file: FileNode }) {
  return (
    <li>
      <Link
        to={`/wiki?path=${encodeURIComponent(file.path)}`}
        className="file-row"
      >
        <span className="file-spacer" />
        <span className="file-name">{file.name.replace(/\.md$/i, "")}</span>
      </Link>
    </li>
  );
}
