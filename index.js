const core = require("@actions/core");
const github = require("@actions/github");
const { SkynetClient: NodeSkynetClient } = require("@nebulous/skynet");
const { parseSkylink, genKeyPairFromSeed, SkynetClient } = require("skynet-js");
const base64 = require("base64-js");
const base32Encode = require("base32-encode");

function decodeBase64(input = "") {
  return base64.toByteArray(
    input.padEnd(input.length + 4 - (input.length % 4), "=")
  );
}

function encodeBase32(input) {
  return base32Encode(input, "RFC4648-HEX", {
    padding: false,
  }).toLowerCase();
}

(async () => {
  try {
    // upload to skynet
    const skynetClient = new NodeSkynetClient();
    const skylink = await skynetClient.uploadDirectory(
      core.getInput("upload-dir")
    );
    core.setOutput("skylink", skylink);
    console.log(`Skylink: ${skylink}`);

    // generate base32 skylink from base64 skylink
    const rawSkylink = parseSkylink(skylink);
    const skylinkDecoded = decodeBase64(rawSkylink);
    const skylinkEncodedBase32 = encodeBase32(skylinkDecoded);
    const skylinkUrl = `https://${skylinkEncodedBase32}.siasky.net`;

    core.setOutput("skylink-url", skylinkUrl);
    console.log(`Deployed to: ${skylinkUrl}`);

    // if registry is properly configured, update the skylink in the entry
    if (core.getInput("registry-seed") && core.getInput("registry-datakey")) {
      try {
        const skynetClient = new SkynetClient("https://siasky.net");
        const seed = core.getInput("registry-seed");
        const dataKey = core.getInput("registry-datakey");
        const { publicKey, privateKey } = genKeyPairFromSeed(seed);
        const { entry } = await skynetClient.registry.getEntry(
          publicKey,
          dataKey
        );
        const revision = entry ? entry.revision + 1 : 0;
        const updatedEntry = { datakey: dataKey, revision, data: rawSkylink };
        await skynetClient.registry.setEntry(privateKey, updatedEntry);
        const entryUrl = skynetClient.registry.getEntryUrl(publicKey, dataKey);
        console.log(`Registry entry updated: ${entryUrl}`);
      } catch (error) {
        console.log(`Failed to update registry entry ${error.message}`);
      }
    }

    // put a skylink in a pull request comment if available
    if (github.context.issue.number) {
      const gitHubToken = core.getInput("github-token");
      const octokit = github.getOctokit(gitHubToken);

      try {
        await octokit.issues.createComment({
          ...github.context.repo,
          issue_number: github.context.issue.number,
          body: `Deployed to ${skylinkUrl}<br>Skylink: \`${skylink}\``,
        });
      } catch (error) {
        console.log(`Failed to create comment: ${error.message}`);
      }
    }
  } catch (error) {
    core.setFailed(`Failed to deploy: ${error.message}`);
  }
})();
