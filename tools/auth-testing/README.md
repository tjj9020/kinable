# Authentication Testing Tools

This directory contains utilities for testing authentication with Amazon Cognito in the Kinable application.

## Files

- `auth-test.html`: A simple HTML/JavaScript client for testing Cognito authentication and making authenticated API requests. Can be served locally with `python3 -m http.server 8080` and accessed at http://localhost:8080/tools/auth-testing/auth-test.html

- `get-cognito-token.js`: A Node.js script for getting authentication tokens from Cognito via the admin API. Useful for command-line testing.

## Usage

These tools are for development and testing purposes only and should not be included in production deployments. 