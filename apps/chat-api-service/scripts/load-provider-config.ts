import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import { marshall } from '@aws-sdk/util-dynamodb';

async function main() {
  const args = process.argv.slice(2);
  const env = args.find(arg => arg.startsWith('--env='))?.split('=')[1];
  const region = args.find(arg => arg.startsWith('--region='))?.split('=')[1];
  const profile = args.find(arg => arg.startsWith('--profile='))?.split('=')[1] || 'kinable-dev';
  const yamlFilePathArg = args.find(arg => arg.startsWith('--yaml-file='))?.split('=')[1];

  if (!env || !region) {
    console.error('Usage: ts-node load-provider-config.ts --env=<environment> --region=<aws-region> [--profile=<aws-profile>] [--yaml-file=<path-to-yaml>]');
    console.error('Example: ts-node load-provider-config.ts --env=kinable-dev --region=us-east-2');
    process.exit(1);
  }

  const yamlFilePath = yamlFilePathArg || path.join(__dirname, '../src/config/provider_config.yaml');
  const tableName = `KinableProviderConfig-${env}`;

  console.log(`Targeting table: ${tableName} in region ${region} using profile ${profile}`);
  console.log(`Loading configuration from: ${path.resolve(yamlFilePath)}`);

  try {
    const fileContents = fs.readFileSync(yamlFilePath, 'utf8');
    const allYamlData: any = yaml.load(fileContents);

    if (!allYamlData || typeof allYamlData !== 'object') {
      console.error('YAML file is empty or not in the expected format (object at the root).');
      process.exit(1);
    }

    for (const configId in allYamlData) {
      if (allYamlData.hasOwnProperty(configId) && allYamlData[configId] && typeof allYamlData[configId] === 'object') {
        console.log(`Processing configId: "${configId}"...`);

        // Deep clone the configuration object for this configId
        // This object should match the AiServiceConfiguration interface
        let serviceConfigData = JSON.parse(JSON.stringify(allYamlData[configId]));

        // Validate if providers map exists
        if (!serviceConfigData.providers || typeof serviceConfigData.providers !== 'object') {
          console.warn(`Skipping configId "${configId}" due to missing or invalid 'providers' block.`);
          continue;
        }
        
        /*
        // Substitute placeholders in secretId within the providers map
        for (const providerKey in serviceConfigData.providers) {
          if (serviceConfigData.providers.hasOwnProperty(providerKey) && 
              serviceConfigData.providers[providerKey].secretId && 
              typeof serviceConfigData.providers[providerKey].secretId === 'string') {
            serviceConfigData.providers[providerKey].secretId = serviceConfigData.providers[providerKey].secretId
              .replace('{env}', env)
              .replace('{region}', region);
          }
        }
        */
        
        // Prepare the item for DynamoDB: configId is the key, rest are attributes
        const itemToPut = {
          configId: configId, // This is the HASH key
          ...serviceConfigData  // Spread all other properties from AiServiceConfiguration
        };
        
        // Update timestamp to current if it's a placeholder or to ensure it's fresh
        if (itemToPut.updatedAt === "NEEDS UPDATE ON EACH CHANGE" || !itemToPut.updatedAt) {
            itemToPut.updatedAt = new Date().toISOString();
            console.log(`Updated 'updatedAt' for configId "${configId}" to current time: ${itemToPut.updatedAt}`);
        }

        const marshalledItem = marshall(itemToPut, {
          convertEmptyValues: false, 
          removeUndefinedValues: true 
        });

        const itemJsonString = JSON.stringify(marshalledItem);
        const escapedItemJsonString = itemJsonString.replace(/'/g, "'\\''");

        const command = `aws dynamodb put-item --table-name "${tableName}" --item '${escapedItemJsonString}' --profile "${profile}" --region "${region}"`;

        console.log(`Executing AWS CLI command for configId "${configId}" (item JSON minimized for brevity)...`);
        execSync(command, { stdio: 'inherit' });
        console.log(`Successfully loaded configId "${configId}" into ${tableName}.`);
      } else {
        console.warn(`Skipping entry "${configId}" as it's not a valid configuration object.`);
      }
    }
    console.log('All configurations processed.');
  } catch (e: any) {
    console.error('Error loading provider config:');
    if (e.stderr) {
      console.error('AWS CLI Stderr:', e.stderr.toString());
    }
    if (e.stdout) {
      console.error('AWS CLI Stdout:', e.stdout.toString());
    }
    // The original error object e will also be printed by the calling E2E test
    // console.error('Full error object for load-provider-config.ts:', e);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
}); 