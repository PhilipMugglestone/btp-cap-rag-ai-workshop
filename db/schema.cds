namespace btpcapragai;

using {
    cuid,
    managed
} from '@sap/cds/common';

entity Conversation : cuid, managed {
    userId   : String;
    title    : String;
    messages : Composition of many Message
                   on messages.conversation = $self;
}

entity Message : cuid, managed {
    conversation : Association to Conversation;
    role         : String;
    content      : LargeString;
}

entity DocumentChunk : cuid {
    text_chunk      : LargeString;
    metadata_column : LargeString;
    embedding       : Vector(1536); // 1536 for Gen AI Hub foundation model embedding or 768 for HANA embedding
}

entity Files : cuid, managed {
    @Core.MediaType  : mediaType  @Core.ContentDisposition.Filename: fileName
    content   : LargeBinary;
    @Core.IsMediaType: true
    mediaType : String;
    fileName  : String;
    size      : String;
}
