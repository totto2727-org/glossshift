{ fetchFromGitHub, applyPatches }:

applyPatches {
  name = "nsh-0.4.0-nightly-c5214aa-glossshift-source";
  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "nsh";
    rev = "c5214aaf4bbdf33bc1d59e9595e009b6aa54d702";
    hash = "sha256-Cmk4NWeFJQAxCWcCEIPFldnOQPg1eD4kWAXCnN4ntjg=";
  };
  patches = [ ../patches/nsh-macos-lifecycle.patch ];
}
