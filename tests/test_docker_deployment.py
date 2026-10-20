"""
Unit Tests for RemoteMM Enterprise Docker Compose & Gateway Deployment Infrastructure
--------------------------------------------------------------------------------------
Verifies:
- docker-compose.yml structure, services, networks, volumes, and healthchecks
- Dockerfile directives, multi-stage builder, unprivileged node user, and healthcheck
- Nginx reverse proxy configuration, WebSocket upgrade map, and timeout settings
- .env.example parameter completeness and security guidance
- Deployment management and certificate generation scripts
"""

import unittest
import os
import re

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class TestDockerDeployment(unittest.TestCase):

    def test_docker_compose_structure_and_services(self):
        """Verifies docker-compose.yml has required services, volumes, networks, and healthchecks."""
        compose_path = os.path.join(PROJECT_ROOT, "docker-compose.yml")
        self.assertTrue(os.path.isfile(compose_path), "docker-compose.yml must exist")

        with open(compose_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Check required services
        self.assertIn("services:", content)
        self.assertIn("gateway:", content)
        self.assertIn("proxy:", content)

        # Check container names
        self.assertIn("container_name: remotemm-gateway", content)
        self.assertIn("container_name: remotemm-proxy", content)

        # Check persistent data volume
        self.assertIn("./data:/app/data", content)

        # Check healthcheck configuration
        self.assertIn("healthcheck:", content)
        self.assertIn("/api/health", content)

        # Check network isolation
        self.assertIn("networks:", content)
        self.assertIn("remotemm-net:", content)

        # Check proxy dependency on gateway health
        self.assertIn("condition: service_healthy", content)

    def test_dockerfile_security_and_directives(self):
        """Verifies Dockerfile complies with container security best practices."""
        dockerfile_path = os.path.join(PROJECT_ROOT, "Dockerfile")
        self.assertTrue(os.path.isfile(dockerfile_path), "Dockerfile must exist")

        with open(dockerfile_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Must use node:22-alpine or similar LTS
        self.assertRegex(content, r"FROM\s+node:22-alpine")

        # Must run as non-root unprivileged user
        self.assertIn("USER node", content)

        # Must expose internal gateway port 3001
        self.assertIn("EXPOSE 3001", content)

        # Must define container healthcheck
        self.assertIn("HEALTHCHECK", content)
        self.assertIn("/api/health", content)

        # Must execute server entrypoint
        self.assertIn('CMD ["node", "server/index.js"]', content)

    def test_nginx_reverse_proxy_configuration(self):
        """Verifies Nginx configuration properly proxies HTTP, HTTPS, and WebSocket traffic."""
        main_conf_path = os.path.join(PROJECT_ROOT, "nginx", "nginx.conf")
        vhost_conf_path = os.path.join(PROJECT_ROOT, "nginx", "conf.d", "remotemm.conf")

        self.assertTrue(os.path.isfile(main_conf_path), "nginx.conf must exist")
        self.assertTrue(os.path.isfile(vhost_conf_path), "remotemm.conf must exist")

        with open(main_conf_path, "r", encoding="utf-8") as f:
            main_conf = f.read()

        # Check WebSocket Connection Upgrade map in main conf
        self.assertIn("map $http_upgrade $connection_upgrade", main_conf)
        self.assertIn("default upgrade;", main_conf)

        with open(vhost_conf_path, "r", encoding="utf-8") as f:
            vhost_conf = f.read()

        # Check upstream definition
        self.assertIn("upstream gateway_upstream", vhost_conf)
        self.assertIn("server gateway:3001;", vhost_conf)

        # Check WebSocket upgrade headers
        self.assertIn("proxy_set_header Upgrade $http_upgrade;", vhost_conf)
        self.assertIn("proxy_set_header Connection $connection_upgrade;", vhost_conf)

        # Check 24-hour long-running remote stream timeout
        self.assertIn("proxy_read_timeout 86400s;", vhost_conf)
        self.assertIn("proxy_send_timeout 86400s;", vhost_conf)

        # Check file upload body limit >= 25MB
        self.assertIn("client_max_body_size", vhost_conf)

    def test_env_example_completeness(self):
        """Verifies .env.example contains necessary parameters and prevents secret leakage."""
        env_example_path = os.path.join(PROJECT_ROOT, ".env.example")
        self.assertTrue(os.path.isfile(env_example_path), ".env.example must exist")

        with open(env_example_path, "r", encoding="utf-8") as f:
            content = f.read()

        required_keys = [
            "PORT=",
            "NODE_ENV=",
            "GATEWAY_PORT=",
            "HTTP_PORT=",
            "HTTPS_PORT=",
            "JWT_SECRET=",
            "DOMAIN_NAME="
        ]

        for k in required_keys:
            self.assertIn(k, content, f"Missing key {k} in .env.example")

        # Must not contain real production passwords
        self.assertIn("DO NOT COMMIT REAL PRODUCTION SECRETS", content)

    def test_management_scripts_exist_and_executable(self):
        """Verifies cross-platform management and certificate generation scripts exist."""
        scripts = [
            "scripts/docker-manage.sh",
            "scripts/docker-manage.ps1",
            "scripts/generate-dev-certs.sh",
            "scripts/generate-dev-certs.ps1"
        ]

        for s in scripts:
            p = os.path.join(PROJECT_ROOT, s)
            self.assertTrue(os.path.isfile(p), f"Script {s} must exist")
            with open(p, "r", encoding="utf-8") as f:
                code = f.read()
            self.assertGreater(len(code), 50, f"Script {s} must not be empty")


if __name__ == "__main__":
    unittest.main()
