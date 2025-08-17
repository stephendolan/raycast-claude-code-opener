import {
  ActionPanel,
  Action,
  List,
  LocalStorage,
  getPreferenceValues,
  showToast,
  Toast,
  Icon,
  Form,
  useNavigation,
  confirmAlert,
  Alert,
} from "@raycast/api";
import { useState, useEffect, useMemo } from "react";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { writeFile, unlink } from "fs/promises";

const execAsync = promisify(exec);

interface Preferences {
  claudeBinaryPath: string;
  terminalApp: "Terminal" | "Alacritty";
}

interface Favorite {
  id: string;
  path: string;
  name?: string;
  addedAt: Date;
  lastOpened?: Date;
  openCount: number;
}

interface FavoritesState {
  favorites: Favorite[];
  version: number;
}

const STORAGE_KEY = "claude-code-favorites";
const CURRENT_VERSION = 1;

function getRelativeTime(date: Date | undefined): string {
  if (!date) return "Never";

  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (seconds < 604800) {
    const days = Math.floor(seconds / 86400);
    if (days === 1) return "Yesterday";
    return `${days} days ago`;
  }
  if (seconds < 2592000) {
    const weeks = Math.floor(seconds / 604800);
    if (weeks === 1) return "Last week";
    return `${weeks} weeks ago`;
  }
  const months = Math.floor(seconds / 2592000);
  if (months === 1) return "Last month";
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return path.join(homedir(), filepath.slice(2));
  }
  return filepath;
}

function getDirectoryName(dirPath: string): string {
  return path.basename(dirPath) || path.dirname(dirPath);
}

const TERMINAL_APPS: Record<string, { bundleId: string; name: string }> = {
  Terminal: { bundleId: "com.apple.Terminal", name: "Terminal" },
  Alacritty: { bundleId: "org.alacritty", name: "Alacritty" },
};

async function openInTerminal(favorite: Favorite, preferences: Preferences, onSuccess: () => void): Promise<void> {
  const expandedPath = expandTilde(favorite.path);
  const claudeBinary = expandTilde(preferences.claudeBinaryPath);

  try {
    const terminalInfo = TERMINAL_APPS[preferences.terminalApp];

    if (!terminalInfo) {
      throw new Error(`Unknown terminal app: ${preferences.terminalApp}`);
    }

    if (preferences.terminalApp === "Terminal") {
      const command = `cd '${expandedPath.replace(/'/g, "'\\''")}'
clear
'${claudeBinary.replace(/'/g, "'\\''")}'
exec bash`;

      const scriptFile = `/tmp/terminal-cmd-${Date.now()}.sh`;
      await writeFile(scriptFile, command, { mode: 0o755 });

      const checkScript = `
        tell application "System Events"
          set isRunning to (name of processes) contains "Terminal"
        end tell
        
        if isRunning then
          tell application "Terminal"
            set windowCount to count of windows
            if windowCount > 0 then
              set frontWindow to front window
              set tabCount to count of tabs of frontWindow
              set currentTab to selected tab of frontWindow
              try
                set isBusy to busy of currentTab
                set processCount to count of processes of currentTab
              catch
                set isBusy to false
                set processCount to 1
              end try
              return "running:" & windowCount & ":" & tabCount & ":" & isBusy & ":" & processCount
            else
              return "running:0:0:false:0"
            end if
          end tell
        else
          return "not_running"
        end if
      `;

      const { stdout: checkResult } = await execAsync(
        `osascript -e '${checkScript.replace(/'/g, "'\"'\"'").replace(/\n/g, "' -e '")}'`,
      );

      let openScript: string;
      const result = checkResult.trim();

      if (result === "not_running") {
        openScript = `
          tell application "Terminal"
            activate
            delay 0.5
            do script "bash ${scriptFile} && rm ${scriptFile}" in front window
          end tell
        `;
      } else {
        const [, windowCount, tabCount, isBusy] = result.split(":");

        if (windowCount === "0") {
          openScript = `
            tell application "Terminal"
              do script "bash ${scriptFile} && rm ${scriptFile}"
              activate
            end tell
          `;
        } else if (tabCount === "1" && (isBusy === "false" || processCount === "1")) {
          openScript = `
            tell application "Terminal"
              do script "bash ${scriptFile} && rm ${scriptFile}" in front window
              activate
            end tell
          `;
        } else {
          openScript = `
            tell application "Terminal"
              do script "bash ${scriptFile} && rm ${scriptFile}"
              activate
            end tell
          `;
        }
      }

      await execAsync(`osascript -e '${openScript.replace(/'/g, "'\"'\"'").replace(/\n/g, "' -e '")}'`);

      onSuccess();
      return;
    }

    if (preferences.terminalApp === "Alacritty") {
      const userShell = process.env.SHELL || "/bin/zsh";
      const shellName = path.basename(userShell);
      
      const initScript = `/tmp/claude-init-${Date.now()}.sh`;
      const initContent = `#!/usr/bin/env ${shellName}
cd '${expandedPath.replace(/'/g, "'\\''")}'
clear
'${claudeBinary.replace(/'/g, "'\\''")}'
exec ${userShell} -l
`;

      await writeFile(initScript, initContent, { mode: 0o755 });

      await execAsync(`open -n -a Alacritty --args -e ${userShell} -l -c "${initScript} && rm -f ${initScript}"`);

      setTimeout(() => {
        unlink(initScript).catch(() => {});
      }, 5000);

      onSuccess();
      return;
    }

    throw new Error(`Unsupported terminal: ${preferences.terminalApp}`);
  } catch (error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to open terminal",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }

  showToast({
    style: Toast.Style.Success,
    title: "Opened in Terminal",
    message: favorite.name || getDirectoryName(favorite.path),
  });
}

function AddFavoriteForm({ onAdd }: { onAdd: (favorite: Favorite) => void }) {
  const { pop } = useNavigation();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (values: { path: string; name: string }) => {
    const expandedPath = expandTilde(values.path);
    const newFavorite: Favorite = {
      id: randomUUID(),
      path: expandedPath,
      name: values.name || undefined,
      addedAt: new Date(),
      openCount: 0,
    };

    onAdd(newFavorite);
    pop();
    showToast({
      style: Toast.Style.Success,
      title: "Added Favorite",
      message: newFavorite.name || getDirectoryName(newFavorite.path),
    });
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Favorite" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="path"
        title="Directory Path"
        placeholder="~/Documents/Projects"
        value={path}
        onChange={setPath}
      />
      <Form.TextField id="name" title="Name (Optional)" placeholder="My Project" value={name} onChange={setName} />
    </Form>
  );
}

function EditFavoriteForm({ favorite, onEdit }: { favorite: Favorite; onEdit: (favorite: Favorite) => void }) {
  const { pop } = useNavigation();
  const [name, setName] = useState(favorite.name || "");

  const handleSubmit = (values: { name: string }) => {
    const updatedFavorite = {
      ...favorite,
      name: values.name || undefined,
    };

    onEdit(updatedFavorite);
    pop();
    showToast({
      style: Toast.Style.Success,
      title: "Updated Favorite",
      message: updatedFavorite.name || getDirectoryName(updatedFavorite.path),
    });
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Favorite" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Path: ${favorite.path}`} />
      <Form.TextField id="name" title="Name" placeholder="My Project" value={name} onChange={setName} />
    </Form>
  );
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const stored = await LocalStorage.getItem<string>(STORAGE_KEY);
      if (stored) {
        const state: FavoritesState = JSON.parse(stored);
        const favorites = state.favorites.map((fav) => ({
          ...fav,
          addedAt: new Date(fav.addedAt),
          lastOpened: fav.lastOpened ? new Date(fav.lastOpened) : undefined,
        }));
        setFavorites(favorites);
      }
    } catch (error) {
      console.error("Failed to load favorites:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load favorites",
        message: "Starting with empty list",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveFavorites = async (newFavorites: Favorite[]) => {
    try {
      const state: FavoritesState = {
        favorites: newFavorites,
        version: CURRENT_VERSION,
      };
      await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setFavorites(newFavorites);
    } catch (error) {
      console.error("Failed to save favorites:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to save favorites",
      });
    }
  };

  const addFavorite = async (favorite: Favorite) => {
    const newFavorites = [...favorites, favorite];
    await saveFavorites(newFavorites);
  };

  const updateFavorite = async (updatedFavorite: Favorite) => {
    const newFavorites = favorites.map((fav) => (fav.id === updatedFavorite.id ? updatedFavorite : fav));
    await saveFavorites(newFavorites);
  };

  const removeFavorite = async (favoriteId: string) => {
    const newFavorites = favorites.filter((fav) => fav.id !== favoriteId);
    await saveFavorites(newFavorites);
  };

  const markAsOpened = async (favoriteId: string) => {
    const newFavorites = favorites.map((fav) =>
      fav.id === favoriteId
        ? {
            ...fav,
            lastOpened: new Date(),
            openCount: fav.openCount + 1,
          }
        : fav,
    );
    await saveFavorites(newFavorites);
  };

  const filteredAndSortedFavorites = useMemo(() => {
    let filtered = favorites;

    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = favorites.filter((fav) => {
        const name = fav.name?.toLowerCase() || "";
        const path = fav.path.toLowerCase();
        const dirName = getDirectoryName(fav.path).toLowerCase();
        return name.includes(searchLower) || path.includes(searchLower) || dirName.includes(searchLower);
      });
    }

    return filtered.sort((a, b) => {
      if (a.lastOpened && b.lastOpened) {
        return b.lastOpened.getTime() - a.lastOpened.getTime();
      }
      if (a.lastOpened && !b.lastOpened) return -1;
      if (!a.lastOpened && b.lastOpened) return 1;

      if (a.openCount !== b.openCount) {
        return b.openCount - a.openCount;
      }

      const nameA = a.name || getDirectoryName(a.path);
      const nameB = b.name || getDirectoryName(b.path);
      return nameA.localeCompare(nameB);
    });
  }, [favorites, searchText]);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search favorites..."
      searchText={searchText}
    >
      {filteredAndSortedFavorites.length === 0 && !searchText ? (
        <List.EmptyView
          icon={Icon.Star}
          title="No Favorites Yet"
          description="Press ⌘N to add your first favorite directory"
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Favorite"
                icon={Icon.Plus}
                target={<AddFavoriteForm onAdd={addFavorite} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            </ActionPanel>
          }
        />
      ) : filteredAndSortedFavorites.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Favorites Found"
          description={`No favorites matching "${searchText}"`}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Favorite"
                icon={Icon.Plus}
                target={<AddFavoriteForm onAdd={addFavorite} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title="Favorites" subtitle={`${filteredAndSortedFavorites.length} items`}>
          {filteredAndSortedFavorites.map((favorite) => (
            <List.Item
              key={favorite.id}
              icon={Icon.Folder}
              title={favorite.name || getDirectoryName(favorite.path)}
              subtitle={favorite.name ? favorite.path : undefined}
              accessories={[
                {
                  text: getRelativeTime(favorite.lastOpened),
                  tooltip: favorite.lastOpened
                    ? `Last opened: ${favorite.lastOpened.toLocaleString()}`
                    : "Never opened",
                },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title={`Open in ${preferences.terminalApp}`}
                    icon={Icon.Terminal}
                    onAction={() => openInTerminal(favorite, preferences, () => markAsOpened(favorite.id))}
                  />
                  <Action.Push
                    title="Edit Name"
                    icon={Icon.Pencil}
                    target={<EditFavoriteForm favorite={favorite} onEdit={updateFavorite} />}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                  />
                  <Action
                    title="Remove Favorite"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      const options: Alert.Options = {
                        title: "Remove Favorite",
                        message: `Are you sure you want to remove "${
                          favorite.name || getDirectoryName(favorite.path)
                        }"?`,
                        primaryAction: {
                          title: "Remove",
                          style: Alert.ActionStyle.Destructive,
                          onAction: () => {
                            removeFavorite(favorite.id);
                            showToast({
                              style: Toast.Style.Success,
                              title: "Removed Favorite",
                            });
                          },
                        },
                      };
                      await confirmAlert(options);
                    }}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  />
                  <ActionPanel.Section>
                    <Action.Push
                      title="Add Favorite"
                      icon={Icon.Plus}
                      target={<AddFavoriteForm onAdd={addFavorite} />}
                      shortcut={{ modifiers: ["cmd"], key: "n" }}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action.CopyToClipboard
                      title="Copy Path"
                      content={favorite.path}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    />
                    <Action.ShowInFinder
                      title="Show in Finder"
                      path={expandTilde(favorite.path)}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
