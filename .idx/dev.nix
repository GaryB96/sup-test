{ pkgs, ... }: {
  idx.previews = {
    enable = true;
    previews = {
      web = {
        command = [ "npm" "run" "start" "--" "--port" "$PORT" "--host" "0.0.0.0" "--disable-host-check" ];
        manager = "web";
        # Optional: specify your app directory
        # cwd = "app/client";
      };
    };
  };
}