package com.acme.rpc.grpc;

import io.grpc.BindableService;
import io.grpc.MethodDescriptor;
import io.grpc.ServerServiceDefinition;
import io.grpc.stub.ServerCalls;
import io.grpc.stub.StreamObserver;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public abstract class OrderQueryGrpcBase implements BindableService {
    public static final String SERVICE_NAME = "acme.order.OrderQuery";
    public static final MethodDescriptor<FindRequest, FindReply> FIND_METHOD = MethodDescriptor.<FindRequest, FindReply>newBuilder()
        .setType(MethodDescriptor.MethodType.UNARY)
        .setFullMethodName(MethodDescriptor.generateFullMethodName(SERVICE_NAME, "Find"))
        .setRequestMarshaller(new MethodDescriptor.Marshaller<FindRequest>() {
            public InputStream stream(FindRequest value) { return new ByteArrayInputStream(value.getId().getBytes(StandardCharsets.UTF_8)); }
            public FindRequest parse(InputStream stream) { return new FindRequest(read(stream)); }
        })
        .setResponseMarshaller(new MethodDescriptor.Marshaller<FindReply>() {
            public InputStream stream(FindReply value) { return new ByteArrayInputStream(value.getValue().getBytes(StandardCharsets.UTF_8)); }
            public FindReply parse(InputStream stream) { return new FindReply(read(stream)); }
        }).build();
    private static String read(InputStream stream) {
        try { return new String(stream.readAllBytes(), StandardCharsets.UTF_8); }
        catch (IOException error) { throw new IllegalArgumentException(error); }
    }
    public void find(FindRequest request, StreamObserver<FindReply> observer) { observer.onError(new UnsupportedOperationException()); }
    @Override public ServerServiceDefinition bindService() {
        return ServerServiceDefinition.builder(SERVICE_NAME).addMethod(FIND_METHOD, ServerCalls.asyncUnaryCall(this::find)).build();
    }
}
