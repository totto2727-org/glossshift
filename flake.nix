{
  description = "A macOS global-shortcut translation popup built with GPUI and Rig";

  inputs.nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";

  outputs =
    { self, nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      mkPkgs = system: import nixpkgs { inherit system; };
    in
    {
      packages = forEachSystem (
        system:
        let
          pkgs = mkPkgs system;
        in
        rec {
          translate-popup = pkgs.callPackage ./package.nix { };
          default = translate-popup;
        }
      );

      devShells = forEachSystem (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          default = pkgs.mkShell {
            inputsFrom = [ self.packages.${system}.default ];
            packages = [
              pkgs.cargo
              pkgs.clippy
              pkgs.just
              pkgs.rustc
              pkgs.rustfmt
            ];
          };
        }
      );
    };
}
