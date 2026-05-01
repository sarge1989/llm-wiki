/**
 * Build a folder tree from a flat list of page paths. Pure data — UI lives
 * in app/components/FolderTree.tsx.
 */

export type FileNode = {
  type: "file";
  name: string;
  path: string;
  size: number;
  updatedAt: number;
};

export type FolderNode = {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

export type FlatPage = {
  path: string;
  name: string;
  size: number;
  updatedAt: number;
};

export function buildTree(pages: FlatPage[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();

  for (const page of pages) {
    const cleanPath = page.path.replace(/^\/+/, "");
    const parts = cleanPath.split("/");
    const fileName = parts.pop();
    if (!fileName) continue;

    let parentChildren = root;
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = {
          type: "folder",
          name: part,
          path: currentPath,
          children: [],
        };
        folders.set(currentPath, folder);
        parentChildren.push(folder);
      }
      parentChildren = folder.children;
    }

    parentChildren.push({
      type: "file",
      name: fileName,
      path: page.path,
      size: page.size,
      updatedAt: page.updatedAt,
    });
  }

  // Folders first, then files, alphabetical within each tier.
  function sortRec(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.type === "folder") sortRec(n.children);
    }
  }
  sortRec(root);
  return root;
}

export function countFiles(folder: FolderNode): number {
  let count = 0;
  for (const child of folder.children) {
    if (child.type === "file") count++;
    else count += countFiles(child);
  }
  return count;
}
