# Build stage: restore and publish the Stargate service into a self-contained folder.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy the project file first to take advantage of Docker layer caching for restores.
COPY stargate/StargateService/StargateService.csproj stargate/StargateService/
RUN dotnet restore stargate/StargateService/StargateService.csproj

# Bring in the full repository and publish the service in Release mode.
COPY . .
WORKDIR /src/stargate/StargateService
RUN dotnet publish -c Release -o /app/publish

# Runtime stage: host the published binaries on the lean ASP.NET image.
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Copy the published output from the build stage.
COPY --from=build /app/publish .

# Bind Kestrel to all interfaces and disable Python automation inside the container.
ENV ASPNETCORE_URLS=http://0.0.0.0:5000
ENV PythonAutomation__Enabled=false

ENTRYPOINT ["dotnet", "StargateService.dll"]
