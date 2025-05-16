# Makefile for SAM build

# Common pnpm install command for production dependencies.
# --frozen-lockfile ensures we use the versions from the lockfile.
# --prod or --omit=dev ensures devDependencies are not installed.

TEMP_LOCKFILE_NAME_IN_MAKEFILE = pnpm-lock.yaml.sam-build-temp
MONOREPO_ROOT = /Volumes/acasus2tb/tim/development/kinable

# Define a common pattern for building a function
# ARTIFACTS_DIR is provided by SAM build environment
define build_function
	@echo "--- Building function artifact in $(ARTIFACTS_DIR) ---"
	@echo "Source directory: $(CURDIR)"
	
	# Ensure artifact directory exists and is clean
	mkdir -p $(ARTIFACTS_DIR)
	
	# Copy application's package.json and dist directory
	@echo "Copying files to $(ARTIFACTS_DIR)"
	cp $(CURDIR)/package.json $(ARTIFACTS_DIR)/package.json
	cp -R $(CURDIR)/dist $(ARTIFACTS_DIR)/
	
	# Create common-types directory with its content BEFORE npm install
	@echo "Creating @kinable/common-types package"
	mkdir -p $(ARTIFACTS_DIR)/node_modules/@kinable/common-types
	# Copy from the local .build-common-types directory that the build script prepared
	cp -R $(CURDIR)/.build-common-types/dist/* $(ARTIFACTS_DIR)/node_modules/@kinable/common-types/
	cp $(CURDIR)/.build-common-types/package.json $(ARTIFACTS_DIR)/node_modules/@kinable/common-types/
	
	# Create a temporary package.json that removes workspace dependencies (common-types is already handled)
	@echo "Creating deployment-ready package.json"
	node -e "const pkg = require('$(ARTIFACTS_DIR)/package.json'); \
		const deps = pkg.dependencies || {}; \
		Object.keys(deps).forEach(key => { \
			if (deps[key].startsWith('workspace:')) { \
				if (key === '@kinable/common-types') { \
					deps[key] = '*'; /* Version doesn't matter since we've already copied the files */ \
				} else { \
					delete deps[key]; \
				} \
			} \
		}); \
		require('fs').writeFileSync('$(ARTIFACTS_DIR)/package.json', JSON.stringify({...pkg, dependencies: deps}, null, 2));"
	
	# Install dependencies using NPM (not pnpm) for Lambda-compatible node_modules structure
	@echo "Installing dependencies with npm"
	cd $(ARTIFACTS_DIR) && npm install --production --no-package-lock
	
	@echo "--- Build complete for $(ARTIFACTS_DIR) ---"
	@echo "Final structure of $(ARTIFACTS_DIR):"
	ls -la $(ARTIFACTS_DIR) | sed "s/^/    /"
	@echo "Checking for critical modules:"
	ls -la $(ARTIFACTS_DIR)/node_modules/aws-jwt-verify 2>/dev/null || echo "    NOT FOUND: aws-jwt-verify"
	ls -la $(ARTIFACTS_DIR)/node_modules/@kinable/common-types 2>/dev/null || echo "    NOT FOUND: @kinable/common-types"
	@echo "------------------------------------------"
endef

# Targets for each function. ARTIFACTS_DIR will be set by SAM CLI for each.
# Ensure the target names match what's in your sam.yaml's Metadata: {MakefileTarget: ...}
# or the Function's LogicalId if no MakefileTarget is specified.

build-LambdaAuthorizerFunction:
	$(call build_function)

build-ChatRouterFunction:
	$(call build_function)

# Example for HelloWorldFunction if it exists and uses makefile build method
build-HelloWorldFunction:
	$(call build_function)

# Add other function targets below if they also use the makefile build method.
# For example, if you have a function with LogicalId 'MyOtherFunction' in sam.yaml:
# build-MyOtherFunction:
#	$(call build_function) 