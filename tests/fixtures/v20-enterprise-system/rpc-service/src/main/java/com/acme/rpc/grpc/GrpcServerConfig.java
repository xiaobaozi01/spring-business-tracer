package com.acme.rpc.grpc;
import io.grpc.ServerServiceDefinition; import org.springframework.context.annotation.Bean; import org.springframework.context.annotation.ComponentScan; import org.springframework.context.annotation.Configuration;
@Configuration @ComponentScan("com.acme.rpc") public class GrpcServerConfig { @Bean ServerServiceDefinition orderQueryServiceDefinition(OrderGrpcService service) { return service.bindService(); } }
